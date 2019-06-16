// ----------------------------------------------------------------------------
// Copyright (c) Microsoft Corporation. All rights reserved.
// ----------------------------------------------------------------------------

const extensions = require('./Extensions');
const Platform = require('../Platform');

exports.notNull = function (value, name) {
    /// <summary>
    /// Ensure the value is not null (or undefined).
    /// </summary>
    /// <param name="value" mayBeNull="true">The value to check.</param>
    /// <param name="name" mayBeNull="true" optional="true">
    /// Optional name of the value to throw.
    /// </param>

    if (extensions.isNull(value)) {
        throw extensions.format(Platform.getResourceString("Validate_NotNullError"), name || 'Value');
    }
};

exports.notNullOrEmpty = function (value, name) {
    /// <summary>
    /// Ensure the value is not null, undefined, or empty.
    /// </summary>
    /// <param name="value" mayBeNull="true">The value to check.</param>
    /// <param name="name" mayBeNull="true" optional="true" type="String">
    /// Optional name of the value to throw.
    /// </param>

    if (extensions.isNullOrEmpty(value)) {
        throw extensions.format(Platform.getResourceString("Validate_NotNullOrEmptyError"), name || 'Value');
    }
};

exports.notNullOrZero = function (value, name) {
    /// <summary>
    /// Ensure the value is not null, undefined, zero, or empty.
    /// </summary>
    /// <param name="value" mayBeNull="true">The value to check.</param>
    /// <param name="name" mayBeNull="true" optional="true" type="String">
    /// Optional name of the value to throw.
    /// </param>

    if (extensions.isNullOrZero(value)) {
        throw extensions.format(Platform.getResourceString("Validate_NotNullOrEmptyError"), name || 'Value');
    }
};

exports.isValidId = function (value, name) {
    /// <summary>
    /// Ensure the value is a valid id for mobile services.
    /// </summary>
    /// <param name="value" mayBeNull="true">The value to check.</param>
    /// <param name="name" mayBeNull="true" optional="true" type="String">
    /// Optional name of the value to throw.
    /// </param>

    if (!extensions.isValidId(value)) {
        throw new Error((name || 'id') + ' "' + value + '" is not valid.');
    }
};

exports.isDate = function (value, name) {
    /// <summary>
    /// Ensure the value is a date.
    /// </summary>
    /// <param name="value" mayBeNull="true">The value to check.</param>
    /// <param name="name" mayBeNull="true" optional="true" type="String">
    /// Optional name of the value to throw.
    /// </param>

    exports.notNull(value, name);
    if (!extensions.isDate(value)) {
        throw extensions.format(
            Platform.getResourceString("TypeCheckError"),
            name || 'Value',
            'Date',
            typeof value);
    }
};

exports.isNumber = function (value, name) {
    /// <summary>
    /// Ensure the value is a number.
    /// </summary>
    /// <param name="value" mayBeNull="true">The value to check.</param>
    /// <param name="name" mayBeNull="true" optional="true" type="String">
    /// Optional name of the value to throw.
    /// </param>

    exports.notNull(value, name);

    if (!extensions.isNumber(value)) {
        throw extensions.format(
            Platform.getResourceString("TypeCheckError"),
            name || 'Value',
            'Number',
            typeof value);
    }
};

exports.isFunction = function (value, name) {
    /// <summary>
    /// Ensure the value is a function.
    /// </summary>
    /// <param name="value" mayBeNull="true">The value to check.</param>
    /// <param name="name" mayBeNull="true" optional="true" type="String">
    /// Optional name of the value to throw.
    /// </param>

    if (!extensions.isFunction(value)) {
        throw extensions.format(
            Platform.getResourceString("TypeCheckError"),
            name || 'Value',
            'Function',
            typeof value);
    }
};

exports.isValidParametersObject = function (value, name) {
    /// <summary>
    /// Ensure the Object instance of user-defined parameters is valid.
    /// </summary>
    /// <param name="value">The parameters to check.</param>
    /// <param name="name" mayBeNull="true" optional="true" type="String">
    /// Optional name of the value to throw.
    /// </param>

    exports.notNull(value, name);
    exports.isObject(value, name);

    for (var parameter in value) {
        if (parameter.indexOf('$') === 0) {
            throw extensions.format(
                Platform.getResourceString("Validate_InvalidUserParameter"),
                name,
                parameter);
        }
    }
};

exports.isInteger = function (value, name) {
    /// <summary>
    /// Ensure the value is an integer.
    /// </summary>
    /// <param name="value" mayBeNull="true">The value to check.</param>
    /// <param name="name" mayBeNull="true" optional="true" type="String">
    /// Optional name of the value to throw.
    /// </param>

    exports.notNull(value, name);
    exports.isNumber(value, name);

    if (parseInt(value, 10) !== parseFloat(value)) {
        throw extensions.format(
            Platform.getResourceString("TypeCheckError"),
            name || 'Value',
            'number',
            typeof value);
    }
};

exports.isBool = function (value, name) {
    /// <summary>
    /// Ensure the value is a bool.
    /// </summary>
    /// <param name="value" mayBeNull="true">The value to check.</param>
    /// <param name="name" mayBeNull="true" optional="true" type="String">
    /// Optional name of the value to throw.
    /// </param>

    if (!extensions.isBool(value)) {
        throw extensions.format(
            Platform.getResourceString("TypeCheckError"),
            name || 'Value',
            'number',
            typeof value);
    }
};

exports.isString = function (value, name) {
    /// <summary>
    /// Ensure the value is a string.
    /// </summary>
    /// <param name="value" mayBeNull="true">The value to check.</param>
    /// <param name="name" mayBeNull="true" optional="true" type="String">
    /// Optional name of the value to throw.
    /// </param>

    if (!extensions.isString(value)) {
        throw extensions.format(
            Platform.getResourceString("TypeCheckError"),
            name || 'Value',
            'string',
            typeof value);
    }
};

exports.isObject = function (value, name) {
    /// <summary>
    /// Ensure the value is an Object.
    /// </summary>
    /// <param name="value" mayBeNull="true">The value to check.</param>
    /// <param name="name" mayBeNull="true" optional="true" type="String">
    /// Optional name of the value to throw.
    /// </param>

    if (!extensions.isObject(value)) {
        throw extensions.format(
            Platform.getResourceString("TypeCheckError"),
            name || 'Value',
            'object',
            typeof value);
    }
};

exports.isArray = function (value, name) {
    /// <summary>
    /// Ensure the value is an Array.
    /// </summary>
    /// <param name="value" mayBeNull="true">The value to check.</param>
    /// <param name="name" mayBeNull="true" optional="true" type="String">
    /// Optional name of the value to throw.
    /// </param>

    if (!Array.isArray(value)) {
        throw extensions.format(
            Platform.getResourceString("TypeCheckError"),
            name || 'Value',
            'array',
            typeof value);
    }
};

exports.length = function (value, length, name) {
    /// <summary>
    /// Ensure the value is of a given length.
    /// </summary>
    /// <param name="value" type="String">
    /// The value to check.
    /// </param>
    /// <param name="length" type="Number" integer="true">
    /// The desired length of the value.
    /// </param>
    /// <param name="name" mayBeNull="true" optional="true" type="String">
    /// Optional name of the value to throw.
    /// </param>

    exports.notNull(value, name);
    exports.isInteger(length, 'length');

    if (value.length !== length) {
        throw extensions.format(
            Platform.getResourceString("Validate_LengthUnexpected"),
            name || 'Value',
            length,
            value.length);
    }
};
