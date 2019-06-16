// ----------------------------------------------------------------------------
// Copyright (c) Microsoft Corporation. All rights reserved.
// ----------------------------------------------------------------------------

const extensions = require('./Utilities/Extensions');
const Validate = require('./Utilities/Validate');
const Platform = require('./Platform');
const Query = require('azure-query-js').Query;
const constants = require('./constants');
const tableHelper = require('./tableHelper');

// Name of the reserved Mobile Services ID member.

// The route separator used to denote the table in a uri like
// .../{app}/collections/{coll}.
const tableRouteSeperatorName = "tables";
const idNames = ["ID", "Id", "id", "iD"];
const nextLinkRegex = /^(.*?);\s*rel\s*=\s*(\w+)\s*$/;

const SystemProperties = {
    None: 0,
    CreatedAt: 1,
    UpdatedAt: 2,
    Version: 4,
    All: 0xFFFF
};

const MobileServiceSystemColumns = {
    CreatedAt: "createdAt",
    UpdatedAt: "updatedAt",
    Version: "version",
    Deleted: "deleted"
};

/**
 * @class
 * @classdesc Represents a table in the Azure Mobile Apps backend.
 * @protected
 * 
 * @param {string} tableName Name of the table in the backend.
 * @param {MobileServiceClient} client The {@link MobileServiceClient} instance associated with this table.
 */
function MobileServiceTable(tableName, client) {

    /**
     * Gets the name of the backend table.
     * 
     * @returns {string} The name of the table.
     */
    this.getTableName = function () {
        return tableName;
    };

    /**
     * Gets the {@link MobileServiceClient} instance associated with this table.
     * 
     * @returns {MobileServiceClient} The {@link MobileServiceClient} associated with this table.
     *///FIXME
    this.getMobileServiceClient = function () {
        return client;
    };

    // Features to associate with all table operations
    this._features = undefined;
}

MobileServiceTable.SystemProperties = SystemProperties;

// We have an internal _read method using callbacks since it's used by both
// table.read(query) and query.read().
MobileServiceTable.prototype._read = function (query, parameters, callback) {
    /// <summary>
    /// Query a table.
    /// </summary>
    /// <param name="query" type="Object" mayBeNull="true">
    /// The query to execute.  It can be null or undefined to get the entire
    /// collection.
    /// </param>
    /// <param name="parameters" type="Object" mayBeNull="true">
    /// An object of user-defined parameters and values to include in the request URI query string.
    /// </param>
    /// <param name="callback" type="Function">
    /// The callback to invoke when the query is complete.
    /// </param>

    // Account for absent optional arguments
    if (extensions.isNull(callback)) {
        if (extensions.isNull(parameters) && (typeof query === 'function')) {
            callback = query;
            query = null;
            parameters = null;
        } else if (typeof parameters === 'function') {
            callback = parameters;
            parameters = null;
            if (!extensions.isNull(query) && extensions.isObject(query)) {
                // This 'query' argument could be either the query or the user-defined 
                // parameters object since both are optional.  A query is either (a) a simple string 
                // or (b) an Object with an toOData member. A user-defined parameters object is just 
                // an Object.  We need to detect which of these has been passed in here.
                if (!extensions.isString(query) && extensions.isNull(query.toOData)) {
                    parameters = query;
                    query = null;
                }
            }
        }
    }

    // Validate the arguments
    if (query && extensions.isString(query)) {
        Validate.notNullOrEmpty(query, 'query');
    }
    if (!extensions.isNull(parameters)) {
        Validate.isValidParametersObject(parameters, 'parameters');
    }
    Validate.notNull(callback, 'callback');

    // Get the query string
    var tableName = this.getTableName();
    var queryString = null;
    var projection = null;
    var features = this._features || [];
    if (extensions.isString(query)) {
        queryString = query;
        if (!extensions.isNullOrEmpty(query)) {
            features.push(constants.features.TableReadRaw);
        }
    } else if (extensions.isObject(query) && !extensions.isNull(query.toOData)) {
        if (query.getComponents) {
            features.push(constants.features.TableReadQuery);
            var components = query.getComponents();
            projection = components.projection;
            if (components.table) {
                // If the query has a table name, make sure it's compatible with
                // the table executing the query

                if (tableName !== components.table) {
                    var message = extensions.format(Platform.getResourceString("MobileServiceTable_ReadMismatchedQueryTables"), tableName, components.table);
                    callback(new Error(message), null);
                    return;
                }

                // The oDataQuery will include the table name; we need to remove
                // because the url fragment already includes the table name.
                var oDataQuery = query.toOData();
                queryString = oDataQuery.replace(new RegExp('^/' + components.table), '');
            }
        }
    }

    addQueryParametersFeaturesIfApplicable(features, parameters);

    // Add any user-defined query string parameters
    if (!extensions.isNull(parameters)) {
        var userDefinedQueryString = extensions.url.getQueryString(parameters);
        if (!extensions.isNullOrEmpty(queryString)) {
            queryString += '&' + userDefinedQueryString;
        }
        else {
            queryString = userDefinedQueryString;
        }
    }

    // Construct the URL
    var urlFragment = queryString;
    if (!extensions.url.isAbsoluteUrl(urlFragment)) {
        urlFragment = extensions.url.combinePathSegments(tableRouteSeperatorName, tableName);
        if (!extensions.isNull(queryString)) {
            urlFragment = extensions.url.combinePathAndQuery(urlFragment, queryString);
        }
    }

    var headers = {};
    headers[constants.apiVersionHeaderName] = constants.apiVersion;

    // Make the request
    this.getMobileServiceClient()._request(
        'GET',
        urlFragment,
        null,
        false,
        headers,
        features,
        function (error, response) {
            var values = null;
            if (extensions.isNull(error)) {
                // Parse the response
                values = extensions.fromJson(response.responseText);

                // If the values include the total count, we'll attach that
                // directly to the array
                if (values &&
                    !Array.isArray(values) &&
                    typeof values.count !== 'undefined' &&
                    typeof values.results !== 'undefined') {
                    // Create a new total count property on the values array
                    values.results.totalCount = values.count;
                    values = values.results;
                }

                // If we have a projection function, apply it to each item
                // in the collection
                if (projection !== null) {
                    var i = 0;
                    for (i = 0; i < values.length; i++) {
                        values[i] = projection.call(values[i]);
                    }
                }

                // Grab link header when possible
                if (Array.isArray(values) && response.getResponseHeader && extensions.isNull(values.nextLink)) {
                    try {
                        var link = response.getResponseHeader('Link');
                        if (!extensions.isNullOrEmpty(link)) {
                            var result = nextLinkRegex.exec(link);

                            // Only add nextLink when relation is next
                            if (result && result.length === 3 && result[2] == 'next') {
                                values.nextLink = result[1];
                            }
                        }
                    } catch (ex) {
                        // If cors doesn't allow us to access the Link header
                        // Just continue on without it
                    }
                }
            }
            callback(error, values);
        });
};

/**
 * Reads records from the backend table.
 * 
 * @function
 * @instance
 * @public
 * @memberof MobileServiceTable
 * 
 * @param {(QueryJs | string)} query Either, a {@link QueryJs} object representing the query to use while
 *                        reading the backend table, OR, a URL encoded OData string for querying. 
 * @param {object} parameters An object of user-defined parameters and values to include in the request URI query string.
 * 
 * @returns {Promise} A promise that is resolved with an array of records read from the table, if the read is successful.
 *                    If read fails, the promise is rejected with the error.
 */
MobileServiceTable.prototype.read = Platform.async(MobileServiceTable.prototype._read);

/**
 * Inserts a new object / record in the backend table.
 * 
 * @function
 * @instance
 * @public
 * @memberof MobileServiceTable
 * 
 * @param {object} instance Object / record to be inserted in the backend table.
 * @param {string | number} instance.id id of the object / record.
 * @param {object} parameters An object of user-defined parameters and values to include in the request URI query string.
 * 
 * @returns {Promise} A promise that is resolved with the inserted object when the insert operation is completed successfully.
 *                    If the operation fails, the promise is rejected with the error.
 */
MobileServiceTable.prototype.insert = Platform.async(
    function (instance, parameters, callback) {

        // Account for absent optional arguments
        if (extensions.isNull(callback) && (typeof parameters === 'function')) {
            callback = parameters;
            parameters = null;
        }

        // Validate the arguments
        Validate.notNull(instance, 'instance');
        if (!extensions.isNull(parameters)) {
            Validate.isValidParametersObject(parameters);
        }
        Validate.notNull(callback, 'callback');

        // Integer Ids can not have any Id set
        for (var i in idNames) {
            var id = instance[idNames[i]];

            if (!extensions.isNullOrZero(id)) {
                if (extensions.isString(id)) {
                    // String Id's are allowed iif using 'id'
                    if (idNames[i] !== 'id') {
                        throw new Error('Cannot insert if the ' + 'id' + ' member is already set.');
                    } else {
                        Validate.isValidId(id, 'id');
                    }
                } else {
                    throw new Error('Cannot insert if the ' + 'id' + ' member is already set.');
                }
            }
        }

        var features = this._features || [];
        features = addQueryParametersFeaturesIfApplicable(features, parameters);

        // Construct the URL
        var urlFragment = extensions.url.combinePathSegments(tableRouteSeperatorName, this.getTableName());
        if (!extensions.isNull(parameters)) {
            var queryString = extensions.url.getQueryString(parameters);
            urlFragment = extensions.url.combinePathAndQuery(urlFragment, queryString);
        }

        var headers = {};
        headers[constants.apiVersionHeaderName] = constants.apiVersion;

        // Make the request
        this.getMobileServiceClient()._request(
            'POST',
            urlFragment,
            instance,
            false,
            headers,
            features,
            function (error, response) {
                if (!extensions.isNull(error)) {
                    callback(error, null);
                } else {
                    var result = getItemFromResponse(response);
                    result = Platform.allowPlatformToMutateOriginal(instance, result);
                    callback(null, result);
                }
            });
    });

/**
 * Update an object / record in the backend table.
 * 
 * @function
 * @instance
 * @public
 * @memberof MobileServiceTable
 * 
 * @param {object} instance New value of the object / record.
 * @param {string | number} instance.id The id of the object / record identifies the record that will be updated in the table.
 * @param {object} parameters An object of user-defined parameters and values to include in the request URI query string.
 * 
 * @returns {Promise} A promise that is resolved when the operation is completed successfully.
 *                    If the operation fails, the promise is rejected with the error.
 */
MobileServiceTable.prototype.update = Platform.async(
    (instance, parameters, callback) => {
        let version,
            headers = {},
            features = this._features || [],
            serverInstance;

        // Account for absent optional arguments
        if (extensions.isNull(callback) && (typeof parameters === 'function')) {
            callback = parameters;
            parameters = null;
        }

        // Validate the arguments
        Validate.notNull(instance, 'instance');
        Validate.isValidId(instance['id'], 'instance.' + 'id');
        if (!extensions.isNull(parameters)) {
            Validate.isValidParametersObject(parameters, 'parameters');
        }
        Validate.notNull(callback, 'callback');

        version = instance[MobileServiceSystemColumns.Version];
        serverInstance = removeSystemProperties(instance);

        if (!extensions.isNullOrEmpty(version)) {
            headers['If-Match'] = getEtagFromVersion(version);
            features.push(constants.features.OptimisticConcurrency);
        }

        headers[constants.apiVersionHeaderName] = constants.apiVersion;

        features = addQueryParametersFeaturesIfApplicable(features, parameters);

        // Construct the URL
        var urlFragment = extensions.url.combinePathSegments(
            tableRouteSeperatorName,
            this.getTableName(),
            encodeURIComponent(instance['id'].toString()));
        if (!extensions.isNull(parameters)) {
            var queryString = extensions.url.getQueryString(parameters);
            urlFragment = extensions.url.combinePathAndQuery(urlFragment, queryString);
        }

        // Make the request
        this.getMobileServiceClient()._request(
            'PATCH',
            urlFragment,
            serverInstance,
            false,
            headers,
            features,
            function (error, response) {
                if (!extensions.isNull(error)) {
                    setServerItemIfPreconditionFailed(error);
                    callback(error);
                } else {
                    var result = getItemFromResponse(response);
                    result = Platform.allowPlatformToMutateOriginal(instance, result);
                    callback(null, result);
                }
            });
    });

MobileServiceTable.prototype.refresh = Platform.async(
    function (instance, parameters, callback) {
        /// <summary>
        ///  Refresh the current instance with the latest values from the
        ///  table.
        /// </summary>
        /// <param name="instance" type="Object">
        /// The instance to refresh.
        /// </param>
        /// <param name="parameters" type="Object" mayBeNull="true">
        /// An object of user-defined parameters and values to include in the request URI query string.
        /// </param>
        /// <param name="callback" type="Function">
        /// The callback to invoke when the refresh is complete.
        /// </param>

        // Account for absent optional arguments
        if (extensions.isNull(callback) && (typeof parameters === 'function')) {
            callback = parameters;
            parameters = null;
        }

        // Validate the arguments
        Validate.notNull(instance, 'instance');
        if (!extensions.isValidId(instance['id'], 'id')) {
            if (typeof instance['id'] === 'string' && instance['id'] !== '') {
                throw new Error('id' + ' "' + instance['id'] + '" is not valid.');
            } else {
                callback(null, instance);
            }
            return;
        }

        if (!extensions.isNull(parameters)) {
            Validate.isValidParametersObject(parameters, 'parameters');
        }
        Validate.notNull(callback, 'callback');

        // Construct the URL
        var urlFragment = extensions.url.combinePathSegments(
            tableRouteSeperatorName,
            this.getTableName());

        if (typeof instance['id'] === 'string') {
            var id = encodeURIComponent(instance['id']).replace(/\'/g, '%27%27');
            urlFragment = extensions.url.combinePathAndQuery(urlFragment, "?$filter=id eq '" + id + "'");
        } else {
            urlFragment = extensions.url.combinePathAndQuery(urlFragment, "?$filter=id eq " + encodeURIComponent(instance['id'].toString()));
        }

        if (!extensions.isNull(parameters)) {
            var queryString = extensions.url.getQueryString(parameters);
            urlFragment = extensions.url.combinePathAndQuery(urlFragment, queryString);
        }

        var features = this._features || [];
        features.push(constants.features.TableRefreshCall);
        features = addQueryParametersFeaturesIfApplicable(features, parameters);

        var headers = {};
        headers[constants.apiVersionHeaderName] = constants.apiVersion;

        // Make the request
        this.getMobileServiceClient()._request(
            'GET',
            urlFragment,
            instance,
            false,
            headers,
            features,
            function (error, response) {
                if (!extensions.isNull(error)) {
                    callback(error, null);
                } else {
                    var result = extensions.fromJson(response.responseText);
                    if (Array.isArray(result)) {
                        result = result[0]; //get first object from array
                    }

                    if (!result) {
                        var message = extensions.format(
                            Platform.getResourceString("MobileServiceTable_NotSingleObject"),
                            'id');
                        callback(new Error(message), null);
                    }

                    result = Platform.allowPlatformToMutateOriginal(instance, result);
                    callback(null, result);
                }
            });
    });

/**
 * Looks up an object / record in the backend table using the object id.
 * 
 * @function
 * @instance
 * @public
 * @memberof MobileServiceTable
 * 
 * @param {string} id id of the object to be looked up in the backend table.
 * @param {object} parameters An object of user-defined parameters and values to include in the request URI query string.
 * 
 * @returns {Promise} A promise that is resolved with the looked up object when the lookup is completed successfully.
 *                    If the operation fails, the promise is rejected with the error.
 */
MobileServiceTable.prototype.lookup = Platform.async(
    function (id, parameters, callback) {
        /// <summary>
        /// Gets an instance from a given table.
        /// </summary>
        /// <param name="id" type="Number" integer="true">
        /// The id of the instance to get from the table.
        /// </param>
        /// <param name="parameters" type="Object" mayBeNull="true">
        /// An object of user-defined parameters and values to include in the request URI query string.
        /// </param>
        /// <param name="callback" type="Function">
        /// The callback to invoke when the lookup is complete.
        /// </param>

        // Account for absent optional arguments
        if (extensions.isNull(callback) && (typeof parameters === 'function')) {
            callback = parameters;
            parameters = null;
        }

        // Validate the arguments
        Validate.isValidId(id, 'id');
        if (!extensions.isNull(parameters)) {
            Validate.isValidParametersObject(parameters);
        }
        Validate.notNull(callback, 'callback');

        // Construct the URL
        var urlFragment = extensions.url.combinePathSegments(
            tableRouteSeperatorName,
            this.getTableName(),
            encodeURIComponent(id.toString()));

        var features = this._features || [];
        features = addQueryParametersFeaturesIfApplicable(features, parameters);

        if (!extensions.isNull(parameters)) {
            var queryString = extensions.url.getQueryString(parameters);
            urlFragment = extensions.url.combinePathAndQuery(urlFragment, queryString);
        }

        var headers = {};
        headers[constants.apiVersionHeaderName] = constants.apiVersion;

        // Make the request
        this.getMobileServiceClient()._request(
            'GET',
            urlFragment,
            null,
            false,
            headers,
            features,
            function (error, response) {
                if (!extensions.isNull(error)) {
                    callback(error, null);
                } else {
                    var result = getItemFromResponse(response);
                    callback(null, result);
                }
            });
    });

/**
 * Deletes an object / record from the backend table.
 * 
 * @function
 * @instance
 * @public
 * @memberof MobileServiceTable
 * 
 * @param {object} instance The object to delete from the backend table. 
 * @param {string} instance.id id of the record to be deleted.
 * @param {object} parameters An object of user-defined parameters and values to include in the request URI query string.
 * 
 * @returns {Promise} A promise that is resolved when the delete operation completes successfully.
 *                    If the operation fails, the promise is rejected with the error.
 */
MobileServiceTable.prototype.del = Platform.async(
    function (instance, parameters, callback) {

        // Account for absent optional arguments
        if (extensions.isNull(callback) && (typeof parameters === 'function')) {
            callback = parameters;
            parameters = null;
        }

        // Validate the arguments
        Validate.notNull(instance, 'instance');
        Validate.isValidId(instance['id'], 'instance.' + 'id');
        Validate.notNull(callback, 'callback');

        var headers = {};
        var features = this._features || [];
        if (extensions.isString(instance['id'])) {
            if (!extensions.isNullOrEmpty(instance[MobileServiceSystemColumns.Version])) {
                headers['If-Match'] = getEtagFromVersion(instance[MobileServiceSystemColumns.Version]);
                features.push(constants.features.OptimisticConcurrency);
            }
        }
        headers[constants.apiVersionHeaderName] = constants.apiVersion;

        features = addQueryParametersFeaturesIfApplicable(features, parameters);

        if (!extensions.isNull(parameters)) {
            Validate.isValidParametersObject(parameters);
        }

        // Contruct the URL
        var urlFragment = extensions.url.combinePathSegments(
            tableRouteSeperatorName,
            this.getTableName(),
            encodeURIComponent(instance['id'].toString()));
        if (!extensions.isNull(parameters)) {
            var queryString = extensions.url.getQueryString(parameters);
            urlFragment = extensions.url.combinePathAndQuery(urlFragment, queryString);
        }

        // Make the request
        this.getMobileServiceClient()._request(
            'DELETE',
            urlFragment,
            null,
            false,
            headers,
            features,
            function (error, response) {
                if (!extensions.isNull(error)) {
                    setServerItemIfPreconditionFailed(error);
                }
                callback(error);
            });
    });

// Define query operators
tableHelper.defineQueryOperators(MobileServiceTable);

// Table system properties
function removeSystemProperties(instance) {
    var copy = {};
    for (var property in instance) {
        if ((property != MobileServiceSystemColumns.Version) &&
            (property != MobileServiceSystemColumns.UpdatedAt) &&
            (property != MobileServiceSystemColumns.CreatedAt) &&
            (property != MobileServiceSystemColumns.Deleted)) {
            copy[property] = instance[property];
        }
    }
    return copy;
}

// Add double quotes and unescape any internal quotes
function getItemFromResponse(response) {
    var result = extensions.fromJson(response.responseText);
    if (response.getResponseHeader) {
        var eTag = response.getResponseHeader('ETag');
        if (!extensions.isNullOrEmpty(eTag)) {
            result[MobileServiceSystemColumns.Version] = getVersionFromEtag(eTag);
        }
    }
    return result;
}

// Converts an error to precondition failed error
function setServerItemIfPreconditionFailed(error) {
    if (error.request && error.request.status === 412) {
        error.serverInstance = extensions.fromJson(error.request.responseText);
    }
}

// Add wrapping double quotes and escape all double quotes
function getEtagFromVersion(version) {
    var result = version.replace(/\"/g, '\\\"');
    return "\"" + result + "\"";
}

// Remove surrounding double quotes and unescape internal quotes
function getVersionFromEtag(etag) {
    var len = etag.length,
        result = etag;

    if (len > 1 && etag[0] === '"' && etag[len - 1] === '"') {
        result = etag.substr(1, len - 2);
    }
    return result.replace(/\\\"/g, '"');
}

// Updates and returns the headers parameters with features used in the call
function addQueryParametersFeaturesIfApplicable(features, userQueryParameters) {
    var hasQueryParameters = false;
    if (userQueryParameters) {
        if (Array.isArray(userQueryParameters)) {
            hasQueryParameters = userQueryParameters.length > 0;
        } else if (extensions.isObject(userQueryParameters)) {
            for (var k in userQueryParameters) {
                hasQueryParameters = true;
                break;
            }
        }
    }

    if (hasQueryParameters) {
        features.push(constants.features.AdditionalQueryParameters);
    }

    return features;
}

// Define the module exports
module.exports = MobileServiceTable;
