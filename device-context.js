window.CardModelHooks={};
try {DeviceModels.migrate(localStorage);DeviceModels.migrateSpark(localStorage);} catch(error) {window.cardMigrationError=error.message;}
window.CardModelSession=DeviceModels.createSession(CardModels,localStorage,CardModelHooks);
