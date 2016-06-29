﻿// ----------------------------------------------------------------------------
// Copyright (c) Microsoft Corporation. All rights reserved.
// ----------------------------------------------------------------------------

/**
 * @file SQLite implementation of the local store.
 * This uses the https://www.npmjs.com/package/cordova-sqlite-storage Cordova plugin.
 */
 
var Platform = require('Platforms/Platform'),
    Validate = require('../../Utilities/Validate'),
    _ = require('../../Utilities/Extensions'),
    ColumnType = require('../../sync/ColumnType'),
    sqliteSerializer = require('./sqliteSerializer'),
    storeHelper = require('./storeHelper'),
    Query = require('azure-query-js').Query,
    formatSql = require('azure-odata-sql').format,
    taskRunner = require('../../Utilities/taskRunner'),
    idPropertyName = "id", // TODO: Add support for case insensitive ID and custom ID column
    defaultDbName = 'mobileapps.db';

/**
 * Initializes a new instance of MobileServiceSqliteStore
 */
var MobileServiceSqliteStore = function (dbName) {

    // Guard against initialization without the new operator
    "use strict";
    if ( !(this instanceof MobileServiceSqliteStore) ) {
        return new MobileServiceSqliteStore(dbName);
    }

    if ( _.isNull(dbName) ) {
        dbName = defaultDbName;
    }

    this._db = window.sqlitePlugin.openDatabase({ name: dbName, location: 'default' });

    var tableDefinitions = {},
        runner = taskRunner();

    /**
     * Defines the schema of the SQLite table
     * @param tableDefinition An object that defines the table, i.e. the table name and columns
     * 
     * Example of a valid tableDefinition object:
     * name: "todoItemTable",
     * columnDefinitions : {
     *      id : "string",
     *      metadata : MobileServiceSqliteStore.ColumnType.Object,
     *      description : "string",
     *      purchaseDate : "date",
     *      price : MobileServiceSqliteStore.ColumnType.Real
     * }
     *
     * If a table with the same name already exists, the newly defined columns in the table definition will be added to the table.
     * If no table with the same name exists, a table with the specified schema will be created.  
     *
     * @returns A promise that is resolved when the operation is completed successfully OR rejected with the error if it fails.
     */
    this.defineTable = function (tableDefinition) {
        var self = this;
        return runner.run(function() {
            storeHelper.validateTableDefinition(tableDefinition);

            tableDefinition = JSON.parse(JSON.stringify(tableDefinition)); // clone the table definition as we will need it later


            return Platform.async(function(callback) {
                self._db.transaction(function(transaction) {

                    // Get the table information
                    var pragmaStatement = _.format("PRAGMA table_info({0});", tableDefinition.name);
                    transaction.executeSql(pragmaStatement, [], function (transaction, result) {

                        // Check if a table with the specified name exists 
                        if (result.rows.length > 0) { // table already exists, add missing columns.

                            // Get a list of columns present in the SQLite table
                            var existingColumns = {};
                            for (var i = 0; i < result.rows.length; i++) {
                                var column = result.rows.item(i);
                                existingColumns[column.name.toLowerCase()] = true;
                            }

                            addMissingColumns(transaction, tableDefinition, existingColumns);
                            
                        } else { // table does not exist, create it.
                            createTable(transaction, tableDefinition);
                        }
                    });

                }, function (error) {
                    callback(error);
                }, function(result) {
                    // Table definition is successful, update the in-memory list of table definitions. 
                    try {
                        storeHelper.addTableDefinition(tableDefinitions, tableDefinition);
                        callback();
                    } catch (error) {
                        callback(error);
                    }
                });
            })();
        });
    };

    /**
     * Updates or inserts one or more objects in the local table
     * 
     * @param tableName Name of the local table in which data is to be upserted.
     * @param data A single object OR an array of objects to be inserted/updated in the table
     * 
     * @returns A promise that is resolved when the operation is completed successfully OR rejected with the error if it fails.
     */
    this.upsert = function (tableName, data) {
        var self = this;
        return runner.run(function() {
            return Platform.async(function(callback) {
                self._db.transaction(function(transaction) {
                    self._upsert(transaction, tableName, data);
                }, function (error) {
                    callback(error);
                }, function () {
                    callback();
                });
            })();
        });
    };
    
    // Performs the upsert operation.
    // This method validates all arguments, callers can skip validation. 
    this._upsert = function (transaction, tableName, data) {

        Validate.isObject(transaction);
        Validate.notNull(transaction);
        Validate.isString(tableName, 'tableName');
        Validate.notNullOrEmpty(tableName, 'tableName');

        var tableDefinition = storeHelper.getTableDefinition(tableDefinitions, tableName);
        if (_.isNull(tableDefinition)) {
            throw new Error('Definition not found for table "' + tableName + '"');
        }

        // If no data is provided, there is nothing more to be done.
        if (_.isNull(data)) {
            return;
        }

        Validate.isObject(data);

        // Compute the array of records to be upserted.
        var records;
        if (!_.isArray(data)) {
            records = [data];
        } else {
            records = data;
        }

        // Serialize the records to a format that can be stored in SQLite.
        for (var i = 0; i < records.length; i++) {
            // Skip null or undefined record objects
            if (!_.isNull(records[i])) {
                Validate.isValidId(storeHelper.getId(records[i]), 'records[' + i + '].' + idPropertyName);
                records[i] = sqliteSerializer.serialize(records[i], tableDefinition.columnDefinitions);
            }
        }


        // Note: The default maximum number of parameters allowed by sqlite is 999
        // Refer http://www.sqlite.org/limits.html#max_variable_number
        // TODO: Add support for tables with more than 999 columns
        if (tableDefinition.columnDefinitions.length > 999) {
            throw new Error("Number of table columns cannot be more than 999");
        }

        var statements = [], // INSERT & UPDATE statements for each record we want to upsert
            parameters = [], // INSERT & UPDATE parameters for each record we want to upsert
            record,
            insertColumnNames = [],
            insertParams = [],
            insertValues = [],
            updateColumnNames = [],
            updateExpressions = [],
            updateValues = [];

        for (i = 0; i < records.length; i++) {

            if (_.isNull(records[i])) {
                continue;
            }
            
            record = records[i];

            // Reset the variables dirtied in the previous iteration of the loop.
            insertColumnNames = [];
            insertParams = [];
            insertValues = [];
            updateColumnNames = [];
            updateExpressions = [];
            updateValues = [];

            for (var property in record) {
                insertColumnNames.push(property);
                insertParams.push('?');
                insertValues.push(record[property]);
                
                if (!storeHelper.isId(property)) {
                    updateColumnNames.push(property);
                    updateExpressions.push(property + ' = ?');
                    updateValues.push(record[property]);
                }
            }
            
            // Insert the instance. If one with the same id already exists, ignore it.
            statements.push(_.format("INSERT OR IGNORE INTO {0} ({1}) VALUES ({2})", tableName, insertColumnNames.join(), insertParams.join()));
            parameters.push(insertValues);

            // If there is any property other than id that needs to be upserted, update the record.
            if (updateValues.length > 0) {
                statements.push(_.format("UPDATE {0} SET {1} WHERE {2} = ?", tableName, updateExpressions.join(), idPropertyName));
                updateValues.push(storeHelper.getId(record)); // Add value of record ID as the last parameter.. for the WHERE clause in the statement.
                parameters.push(updateValues);
            }
        }

        // Execute the INSERT and UPDATE statements.
        for (i = 0; i < statements.length; i++) {
            if (this._editStatement) { // test hook
                statements[i] = this._editStatement(statements[i]);
            }
            transaction.executeSql(statements[i], parameters[i]);
        }
    };

    /**
     * Perform a record lookup in the local table
     * 
     * @param tableName Name of the local table in which lookup is to be performed
     * @param id ID of the object to be looked up
     * @param {boolean} [suppressRecordNotFoundError] If set to true, lookup will return an undefined object if the record is not found.
     *                                                Otherwise, lookup will fail. 
     *                                                This flag is useful to distinguish between a lookup failure due to the record not being present in the table
     *                                                versus a genuine failure in performing the lookup operation
     * 
     * @returns Promise that will be resolved with the looked up object when the operation completes successfully OR 
     * rejected with the error if it fials. 
     */
    this.lookup = function (tableName, id, suppressRecordNotFoundError) {
        var self = this;
        return runner.run(function() {
            // Validate the arguments
            Validate.isString(tableName, 'tableName');
            Validate.notNullOrEmpty(tableName, 'tableName');
            Validate.isValidId(id, 'id');
            
            var tableDefinition = storeHelper.getTableDefinition(tableDefinitions, tableName);
            if (_.isNull(tableDefinition)) {
                throw new Error('Definition not found for table "' + tableName + '"');
            }

            var lookupStatement = _.format("SELECT * FROM [{0}] WHERE {1} = ? COLLATE NOCASE", tableName, idPropertyName);

            return Platform.async(function(callback) {
                self._db.executeSql(lookupStatement, [id], function (result) {
                    try {
                        var record;
                        if (result.rows.length !== 0) {
                            record = result.rows.item(0);
                        }

                        if (record) {
                            // Deserialize the record read from the SQLite store into its original form.
                            record = sqliteSerializer.deserialize(record, tableDefinition.columnDefinitions);
                            callback(null, record);
                        } else if (suppressRecordNotFoundError) {
                            callback();
                        } else {
                            callback(new Error('Item with id "' + id + '" does not exist.'));
                        }
                    } catch (err) {
                        callback(err);
                    }
                }, function (err) {
                    callback(err);
                });
            })();
        });
    };

    /**
     * Deletes one or more records from the local table
     * 
     * @param tableNameOrQuery Either the name of the local table in which delete is to be performed,
     *                         Or a QueryJS object defining records to be deleted.
     * @param ids A single ID or an array of IDs of records to be deleted
     *            This argument is expected only if the first argument is table name and not a QueryJS object.
     * 
     * @returns Promise that is resolved when the operation completes successfully or rejected with the error if it fails.
     */
    this.del = function (tableNameOrQuery, ids) {
        var self = this;
        return runner.run(function() {
            return Platform.async(function(callback) {
                // Validate parameters
                Validate.notNull(tableNameOrQuery);

                if (_.isString(tableNameOrQuery)) { // tableNameOrQuery is table name, delete records with specified IDs.
                    Validate.notNullOrEmpty(tableNameOrQuery, 'tableNameOrQuery');

                    // If a single id is specified, convert it to an array and proceed.
                    // Detailed validation of individual IDs in the array will be taken care of later.
                    if (!_.isArray(ids)) {
                        ids = [ids];
                    }
                    
                    self._db.transaction(function(transaction) {
                        for (var i in ids) {
                            if (! _.isNull(ids[i])) {
                                Validate.isValidId(ids[i]);
                            }
                        }
                        self._deleteIds(transaction, tableNameOrQuery /* table name */, ids);
                    }, function (error) {
                        callback(error);
                    }, function () {
                        callback();
                    });

                } else if (_.isObject(tableNameOrQuery)) { // tableNameOrQuery is a query, delete all records specified by the query.
                    self._deleteUsingQuery(tableNameOrQuery /* query */, callback);
                } else { // error
                    throw _.format(Platform.getResourceString("TypeCheckError"), 'tableNameOrQuery', 'Object or String', typeof tableNameOrQuery);
                }
            })();
        });
    };
    
    // Deletes the records selected by the specified query and notifies the callback.
    this._deleteUsingQuery = function (query, callback) {

        var self = this;
    
        // The query can have a 'select' clause that queries only specific columns. However, we need to know the ID value
        // to be able to delete records. So we explicitly remove selection from the query, if any.
        var components = query.getComponents();
        if (components.selections && components.selections.length > 0) {
            components.selections = [];
            query.setComponents(components);
        }

        // Run the query and get the list of records to be deleted
        self.read(query).then(function (result) {
            try {
                if (!_.isArray(result)) { // This can happen if the query used to read contains includeCount()
                    result = result.result;
                    Validate.isArray(result);
                }

                var tableName = query.getComponents().table;
                Validate.isString(tableName);
                Validate.notNullOrEmpty(tableName);

                // Get list of IDs from the records returned by read.
                var ids = [];
                result.forEach(function(record) {
                    ids.push(record[idPropertyName]);
                });

                // Delete the records returned by read.
                self._db.transaction(function(transaction) {
                    self._deleteIds(transaction, tableName, ids);
                }, function(error) {
                    callback(error);
                }, function() {
                    callback();
                });

            } catch (error) {
                callback(error);
            }
        }, function (error) {
            callback(error);
        });
    };

    // Delete records from the table that match the specified IDs.
    this._deleteIds = function (transaction, tableName, ids) {
        var deleteExpressions = [],
            deleteParams = [];
        for (var i = 0; i < ids.length; i++) {
            if (!_.isNull(ids[i])) {
                deleteExpressions.push('?');
                deleteParams.push(ids[i]);
            }
        }
        
        var deleteStatement = _.format("DELETE FROM {0} WHERE {1} in ({2})", tableName, idPropertyName, deleteExpressions.join());
        if (this._editStatement) { // test hook
            deleteStatement = this._editStatement(deleteStatement);
        }
        transaction.executeSql(deleteStatement, deleteParams);
    };

    /**
     * Read a local table
     * 
     * @param query A QueryJS object representing the query to use while reading the table
     * @returns A promise that is resolved with the read results when the operation is completed successfully or rejected with
     *          the error if it fails.
     */
    this.read = function (query) {
        return runner.run(function() {
            Validate.notNull(query, 'query');
            Validate.isObject(query, 'query');

            return this._read(query);
        }.bind(this));
    };

    this._read = function (query) {
        return Platform.async(function(callback) {

            var tableDefinition = storeHelper.getTableDefinition(tableDefinitions, query.getComponents().table);
            if (_.isNull(tableDefinition)) {
                throw new Error('Definition not found for table "' + query.getComponents().table + '"');
            }

            var count,
                result = [],
                statements = getSqlStatementsFromQuery(query);

            this._db.transaction(function (transaction) {

                // If the query requests the result count we expect 2 SQLite statements. Else, we expect a single statement.
                if (statements.length < 1 || statements.length > 2) {
                    throw Platform.getResourceString("MobileServiceSqliteStore_UnexptedNumberOfStatements");
                }

                // The first statement gets the query results. Execute it.
                // TODO: Figure out a better way to determine what the statements in the array correspond to.    
                transaction.executeSql(statements[0].sql, getStatementParameters(statements[0]), function (transaction, res) {
                    var record;
                    for (var j = 0; j < res.rows.length; j++) {
                        // Deserialize the record read from the SQLite store into its original form.
                        record = sqliteSerializer.deserialize(res.rows.item(j), tableDefinition.columnDefinitions);
                        result.push(record);
                    }
                });

                // Check if there are multiple statements. If yes, the second is for the result count.
                if (statements.length === 2) {
                    transaction.executeSql(statements[1].sql, getStatementParameters(statements[1]), function (transaction, res) {
                        count = res.rows.item(0).count;
                    });
                }
            }, function (error) {
                callback(error);
            }, function () {
                // If we fetched the record count, combine the records and the count into an object.
                if (count !== undefined) {
                    result = {
                        result: result,
                        count: count
                    };
                }
                callback(null, result);
            });
        }.bind(this))();
    };
    
    /**
     * Executes the specified operations as part of a single SQL transaction.
     * 
     * @param operations Array of operations to be performed. Each operation in the array is an object of the following form:
     * {
     *      action: 'upsert',
     *      tableName: name of the table,
     *      data: record / object to be upserted
     * }
     * 
     * OR
     * 
     * {
     *      action: 'delete',
     *      tableName: name of the table,
     *      id: ID of the record to be deleted
     * }
     * 
     * @returns A promise that is resolved when the operations are completed successfully OR rejected with the error if they fail.
     */
    this.executeBatch = function (operations) {
        var self = this;
        return runner.run(function() {
            Validate.isArray(operations);

            return Platform.async(function(callback) {
                self._db.transaction(function(transaction) {
                    for (var i in operations) {
                        var operation = operations[i];
                        
                        if (_.isNull(operation)) {
                            continue;
                        }
                        
                        Validate.isString(operation.action);
                        Validate.notNullOrEmpty(operation.action);

                        Validate.isString(operation.tableName);
                        Validate.notNullOrEmpty(operation.tableName);
                        
                        if (operation.action.toLowerCase() === 'upsert') {
                            self._upsert(transaction, operation.tableName, operation.data);
                        } else if (operation.action.toLowerCase() === 'delete') {
                            if ( ! _.isNull(operation.id) ) {
                                Validate.isValidId(operation.id);
                                self._deleteIds(transaction, operation.tableName, [operation.id]);
                            }
                        } else {
                            throw new Error(_.format("Operation '{0}' is not supported", operation.action));
                        }
                    }
                }, function (error) {
                    callback(error);
                }, function () {
                    callback();
                });
            })();
        });
    };
};

// Converts the QueryJS object into equivalent SQLite statements
function getSqlStatementsFromQuery(query) {
    
    // Convert QueryJS object to an OData query string
    var odataQuery = Query.Providers.OData.toOData(query);
    
    // Convert the OData query string into equivalent SQLite statements
    var statements = formatSql(odataQuery, { flavor: 'sqlite' });
    
    return statements;
}

// Gets the parameters from a statement defined by azure-odata-sql
function getStatementParameters(statement) {
    var params = [];

    if (statement.parameters) {
        statement.parameters.forEach(function (param) {
            params.push(sqliteSerializer.serializeValue(param.value));
        });
    }

    return params;
}

// Creates a table as per the specified definition and as part of the specified SQL transaction. 
function createTable(transaction, tableDefinition) {

    var columnDefinitions = tableDefinition.columnDefinitions;
    var columnDefinitionClauses = [];

    for (var columnName in columnDefinitions) {
        var columnType = storeHelper.getColumnType(columnDefinitions, columnName);

        var columnDefinitionClause = _.format("[{0}] {1}", columnName, sqliteSerializer.getSqliteType(columnType));

        if (storeHelper.isId(columnName)) {
            columnDefinitionClause += " PRIMARY KEY";
        }

        columnDefinitionClauses.push(columnDefinitionClause);
    }
    
    var createTableStatement = _.format("CREATE TABLE [{0}] ({1})", tableDefinition.name, columnDefinitionClauses.join());

    transaction.executeSql(createTableStatement);
}

// Alters the table to add the missing columns
function addMissingColumns(transaction, tableDefinition, existingColumns) {

    // Add necessary columns to the table
    var columnDefinitions = tableDefinition.columnDefinitions;
    for (var columnName in columnDefinitions) {

        // If this column does not already exist, we need to create it.
        // SQLite does not support adding multiple columns using a single statement. Add one column at a time.
        if (!existingColumns[columnName.toLowerCase()]) {
            var alterStatement = _.format("ALTER TABLE {0} ADD COLUMN {1} {2}", tableDefinition.name, columnName, storeHelper.getColumnType(columnDefinitions, columnName));
            transaction.executeSql(alterStatement);
        }
    }
}

// Valid Column types
MobileServiceSqliteStore.ColumnType = ColumnType;

// Define the module exports
module.exports = MobileServiceSqliteStore;
