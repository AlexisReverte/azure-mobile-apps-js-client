# Microsoft Azure Mobile Apps: Javascript Client SDK

With Microsoft Azure Mobile Apps you can add a scalable backend to your connected client applications in minutes. To learn more, visit our [Developer Center](http://azure.microsoft.com/en-us/develop/mobile).

## Getting Started

If you are new to Azure Mobile Apps, you can get started by following the [Mobile Apps documentation](https://azure.microsoft.com/en-us/documentation/learning-paths/appservice-mobileapps/)

The JavaScript SDK makes it easy to use Microsoft Azure Mobile Apps. To connect to an Azure App Service from a Cordova application, refer [How to Use Apache Cordova Client Library for Azure Mobile Apps](https://azure.microsoft.com/en-us/documentation/articles/app-service-mobile-cordova-how-to-use-client-library/)

The SDK can be used from a web app that runs in a browser or from a Cordova app. The SDK code in this repository is packed into a standalone bundle and is available as a Cordova plugin at https://github.com/Azure/azure-mobile-apps-cordova-client. Refer https://github.com/Azure/azure-mobile-apps-cordova-client for more details about how to use the Cordova plugin.

### Usage

Run the following command to get the Javascript client for Azure Mobile Apps:

    npm install azure-mobile-apps-client
    
The SDK files are present in the package's _/dist_ directory.

### Offline data sync (Preview)

Offline data sync is a feature of Azure Mobile Apps that makes it easy for developers to create apps that are functional without a network connection. Offline data sync is now available in the Cordova SDK.

https://azure.microsoft.com/en-us/documentation/articles/app-service-mobile-offline-data-sync/ explains the basic concepts of offline data sync. The following sections explain how to perform various operations involved in offline data sync.

#### Initializing the store

`MobileServiceSqliteStore` is a SQLite store which is available out of the box. You can create an instance of the SQLite store in the following manner:
```
var store = new WindowsAzure.MobileServiceSqliteStore('store.db');
```

Next step is defining the tables in the store that will be participating in offline data sync. This can be performed using the `defineTable` method:
```
store.defineTable({
    name: 'todoitem',
    columnDefinitions: {
        id: 'string',
        text: 'string',
        deleted: 'boolean',
        complete: 'boolean'
    }
});
```
The `defineTable(..)` method returns a promise that is fulfilled when the table creation is complete. If a table with the same name already exists, `defineTable` will only add columns that are missing, existing columns (type and the data in them) will not be affected, even if the new definition does not contain definitions for existing columns.

The `columnDefinitions` property specifies the types of columns. Valid column types are `'object'`, `'array'`, `'date'`, `'integer'` or `'int'`, `'float'` or `'real'`, `'string'` or `'text'`, `'boolean'` or `'bool'`. Some of these types like `'integer'` or `'float'` do not have a corresponding Javascript type, but are needed to specify the type of the column in the store. As the table data will eventually be pushed to the server tables, defining the column types in advance helps us proactively enforce type safety which otherwise would only manifest as an error while pushing the data to the server.

The column type is used to verify that the inserted data matches the column type. It is also useful in reading the data back from the table in the correct form.

**Note** that if the type of an existing column is changed by a future `defineTable(..)` call, reading from the table will attempt to convert the data into the new column type. This can cause weird behavior while reading from the table as the existing column data may be incompatible with the new type.

#### Initializing the sync context

Next step after initializing the store is initializing the sync context:
```
var client = new WindowsAzure.MobileServiceClient('https://mobile-apps-url'); // define the client
var syncContext = client.getSyncContext(); // get the sync context from the client
syncContext.initialize(store); // initialize the sync context with the store
```
`initialize` returns a promise that is fulfilled when the sync context is initialized.

You can also implement your own custom store and initialize the `syncContext` with it.

#### Obtaining reference to a local table

Once the sync context is initialized, reference to a local table can be obtained as shown below:
```
var table = client.getSyncTable('todoitem' /* table name */);
```

Note that, `getSyncTable(..)` does not actually create the table in the store. It only obtains a reference to it. The actual table has to be created using `defineTable` as explained above.

#### CRUD operations on the local table

You can perform CRUD operations on the local table in the same way as you would on the online tables using `insert`, `update`, `del`, `read` and `lookup`. You can find more details at https://azure.microsoft.com/en-us/documentation/articles/app-service-mobile-html-how-to-use-client-library/

#### Pulling data into the local table

You can pull data from the online tables into the local table using the `pull` method:
```
syncContext.pull(new WindowsAzure.Query('todoitem' /* table name */));
```

`WindowsAzure.Query` is a QueryJS object. You can read more about it at https://msdn.microsoft.com/library/azure/jj613353 and https://github.com/Azure/azure-query-js. You can selectively pull table data by defining an appropriate query.

`pull` returns a promise that is resolved when the pull operation is complete. 

To pull data incrementally, so that subsequent pulls only fetch what has changed since the previous pull, you can pass a `queryId` that uniquely identifies the logical query in your application. `queryId` helps the SDK determine what changes have been pulled from the server already.

```
syncContext
    .pull(new WindowsAzure.Query('todoitem' /* table name */), 'all_todo_items' /* unique queryId */)
    .then(function() { /* pull complete */ });
```

##### Custom page size
The default page size used to pull records (during both vanilla pull as well as incremental pull) is 50. You can specify a custom page size while performing pull.

```
var query = new WindowsAzure.Query('todoitem' /* table name */),
    queryId = 'all_todo_items',
    pullSettings = {
        pageSize: 75
    };
syncContext
    .pull(query, queryId, pullSettings)
    .then(function() { /* purge complete */ });
```

#### Pushing data to the tables on the server

You can push the changes you made to the local tables using the sync context's `push` method.
```
syncContext
    .push()
    .then(function() { /* push complete */ });
```

The `push` method returns a promise that is fulfilled when the push operation is completed successfully.

##### Conflict and error handling

Changes are pushed to the server, one change at a time. Pushing a change can result in a conflict or an error, which can be handled using the `pushHandler`.

Here is how you register a push handler:
```
syncContext.pushHandler = {
    onConflict: function (pushError) {
        // Handle the conflict
    },
    onError: function (pushError) {
        // Handle the error
    }
};
```

The `pushError` object contains all the details of the error / conflict and has helper methods to resolve it.

_Informational methods:_

`pushError` provides the following informational methods:

* `getServerRecord()`  - Get the value of the record on the server. Note that the server value will not be available in the _onError_ callback and _may not be always available_ in the _onConflict_ callback depending on the kind of conflict. Specifically, the server value will not be available when the server inserts or deletes a record and the client inserts a record with the same ID. This should be rare if you use GUIDs for IDs.

* `getClientRecord()`  - Get the value of the record that was attempted to be pushed from the client to server 

* `getError()`  - Get the detailed underlying error that caused the push to fail

* `getTableName()` - Get the name of the table for which the push was attempted

* `getAction()` - Gets the operation that was being pushed. Valid actions are 'insert', 'update' and 'delete'.

_Conflict handling methods:_

`pushError` provides the following methods for resolving conflicts. All are asynchronous methods that return a promise.

* `cancelAndUpdate(newValue)` - Cancels the push operation for the current change and updates the record in the local table. `newValue` is the new value of the record that will be updated in the local table.

* `cancelAndDiscard` - Cancels the push operation for the current change and discards the corresponding record from the local table.

* `cancel` - Cancels the push operation for the current operation and leaves the corresponding record in the local table untouched.

* `update(newValue)` - Updates the client data record associated with the current operation. `newValue` specifies the new value of the record.

* `changeAction(newAction, newClientRecord)` - Changes the type of operation that was being pushed to the server. This is useful for handling conflicts where you might need to change the type of operation to be able to push the changes to the server. Example: You might need to change `'insert'` to `'update'` to be able to push a record that was already inserted on the server. Note that changing the action to `'delete'` will implicitly remove the associated record from the corresponding local table. Valid values for `newAction` are `'insert'`, `'update'` and `'delete'`. `newClientRecord` specifies the new value of the client record when `newAction` is `'insert'` or `'update'`, and is unused when `newAction` is `'delete'`.

    Using any one of these conflict handling methods will mark the pushError as handled, i.e. `pushError.isHandled = true` so that the push operation can attempt to push the chage again, unless it was cancelled using one of the conflict handling methods. If, however, you wish to skip pushing the change despite using one of the conflict handling methods, you can set `pushError.isHandled = false` after the conflict handling methods you used are complete.

* `isHandled` - Using one of the above conflict handling methods automatically sets this property to `true`. Set this property to `false` if you have handled the error using one of the above conflict handling methods and yet you want to skip pushing the change. If you resolved the conflict without using any of the above conflict handling methods, you need to set `isHandled = true;` explicitly.

All unhandled conflicts are noted and passed to the user as an array when the pull operation is complete.

The `onError (pushError)` method is called when the push fails due to an error. If you handle the error, you can set `isHandled = true` so that push can resume. An unhandled error will abort the push operation, unlike an unhandled conflict. The `pushError` methods explained in the conflict handling section are available for use for error handling too.

#### Purging local tables
The `purge(query, forcePurge)` method lets you purge records from the local table. Purging a record is different from deleting it. Deleting a record will log the change in the operation table and the delete operation will be pushed to the server when changes are pushed. Purge on the other hand does not log anything to the operation table.

This is how you can purge records from a local table:

```
var purgeQuery = new WindowsAzure.Query('todoitem' /* table name */); // purge entire table
client
    .getSyncContext()
    .purge(query)
    .then(function() { /* purge complete */ });
```
OR
```
var purgeQuery = new WindowsAzure.Query('todoitem' /* table name */).where(function() {
    return this.price === 101; // selectively purge record with price 101
};
client
    .getSyncContext()
    .purge(query)
    .then(function() { /* purge complete */ });
```

`purge(..)` returns a promise that is resolved when the purge operation is complete. Purging a table removes all incremental sync state associated with that table. This means next time an incremental `pull(..)` is performed, all the records associated with the pull query will be fetched again.

If the table being purged has pending changes that haven't been pushed to the server yet, the purge operation will fail. You can force purge the table if you wish to disregard pending changes and proceed with the purge. Force purging will also remove all pending operations associated with the table. This means, no changes made to the table will be pushed if you force purge it and then perform a push operation.

This is how you can force purge a table:
```
var purgeQuery = new WindowsAzure.Query('todoitem' /* table name */); // purge entire table
client
    .getSyncContext()
    .purge(query, true /* force purge */)
    .then(function() { /* purge complete */ });
```

### Closing the store
After you are done using the store, you can close the connection to it using the store's `close()` method.
```
store
    .close()
    .then(function() { /* store closed */ });
```
`close()` returns a promise that will be resolved when the store is closed. Once a store is closed, no store operations can be performed on it.

#### Future work

Brief list of work planned in the future:
- ability to cancel push and pull operations
- triggering a push automatically when a pull is performed
- support for math and date/time functions while querying for records
- callback to allow changing how records are sent to the server during a push
- configurable ID column. Currently ID column has to be named 'id'.

All these will be added over a series of updates in the next few days. Stay tuned!

### Build
    
To build the SDK yourself, run:

    git clone https://github.com/Azure/azure-mobile-apps-js-client.git
    cd azure-mobile-apps-js-client
    npm install
    npm run build

The built files will be copied to the _/dist_ directory.

### Running Unit Tests

To run the WinJS Windows Store test app:

1. Open the ```sdk\Microsoft.WindowsAzure.Mobile.JS.sln``` file in Visual Studio.
2. In the Solution Explorer, right-click on the ```Microsoft.WindowsAzure.Mobile.WinJS.Test``` project in the Solution Explorer and select ```Set as StartUp Project```.
3. Press F5 to run the application in debug mode.
4. A Windows Store application will appear with a prompt for a Runtime Uri and Tags. You can safely ignore this prompt and just click the Start button.
5. The test suite will run and display the results.

To run the HTML tests:

1. Open the ```sdk\Microsoft.WindowsAzure.Mobile.JS.sln``` file in Visual Studio.
2. In the Solution Explorer, select the Microsoft.WindowsAzure.Mobile.WinJS.Test project and right-click to select 'View in Browser'.
3. The default browser will launch and run the test HTML application. Some tests may fail because due to an 'Unexpected connection failure'. This is because the test is configured to connect to a Mobile Service that does not exist. These failures can be ignored.

## Change log
- [JavaScript SDK](CHANGELOG.md)

## Useful Resources

* [Getting Started with Azure Mobile Apps](https://azure.microsoft.com/en-us/documentation/learning-paths/appservice-mobileapps/)
* [Quickstart](https://azure.microsoft.com/en-us/documentation/articles/app-service-mobile-cordova-get-started/)
* Tutorials and product overview are available at [Microsoft Azure Mobile Apps Developer Center](http://azure.microsoft.com/en-us/develop/mobile).
* Our product team actively monitors the [Mobile Services Developer Forum](http://social.msdn.microsoft.com/Forums/en-US/azuremobile/) to assist you with any troubles.

## Contribute Code or Provide Feedback

This project has adopted the [Microsoft Open Source Code of Conduct](https://opensource.microsoft.com/codeofconduct/). For more information see the [Code of Conduct FAQ](https://opensource.microsoft.com/codeofconduct/faq/) or contact [opencode@microsoft.com](mailto:opencode@microsoft.com) with any additional questions or comments.

If you would like to become an active contributor to this project please follow the instructions provided in [Microsoft Azure Projects Contribution Guidelines](http://azure.github.com/guidelines.html).

If you encounter any bugs with the library please file an issue in the [Issues](https://github.com/Azure/azure-mobile-apps-js-client/issues) section of the project.
