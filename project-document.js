// Project document: the whole project as one versioned JSON object, for saving
// and sharing. No UI. Wraps the session object of the JSON export/import:
// get() reads it via bcBuildSessionData(), apply() restores it via applyImport().
(function () {
  'use strict';

  var SCHEMA = 'bc-project';
  var SCHEMA_VERSION = 1;

  function get() {
    return {
      schema: SCHEMA,
      schemaVersion: SCHEMA_VERSION,
      savedAt: new Date().toISOString(),
      session: bcBuildSessionData()
    };
  }

  // Upgrades an older document to SCHEMA_VERSION. Future versions add a step
  // per version here. v1 is the current version: returned unchanged.
  function migrate(doc) {
    if (doc.schemaVersion === SCHEMA_VERSION) return doc;
    throw new Error('Unsupported project document version: ' + String(doc.schemaVersion) +
      ' (supported: ' + SCHEMA_VERSION + ').');
  }

  // Validates the document first and throws without changing anything when it
  // is not a valid bc-project document of a supported version.
  function apply(doc) {
    if (!doc || typeof doc !== 'object' || doc.schema !== SCHEMA) {
      throw new Error('Not a project document (expected schema "' + SCHEMA + '").');
    }
    if (typeof doc.schemaVersion !== 'number') {
      throw new Error('Project document has no schemaVersion.');
    }
    doc = migrate(doc);
    if (!doc.session || typeof doc.session !== 'object' || !doc.session.version) {
      throw new Error('Project document has no valid session data.');
    }
    applyImport(doc.session);
  }

  window.ProjectDocument = {
    SCHEMA: SCHEMA,
    SCHEMA_VERSION: SCHEMA_VERSION,
    get: get,
    apply: apply,
    migrate: migrate
  };
})();
