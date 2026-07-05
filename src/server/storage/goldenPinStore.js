const { GOLDEN_PIN_FILE } = require("../config");
const { readJsonFile, writeJsonFile } = require("../storage/jsonStore");

function emptyGoldenPinStore() {
  return {
    status: "idle",
    refreshedAt: "",
    nextRefreshAt: "",
    date: "",
    data: [],
    scannedCount: 0,
    qualifiedCount: 0,
    error: ""
  };
}

function readGoldenPinStore() {
  return readJsonFile(GOLDEN_PIN_FILE, emptyGoldenPinStore());
}

function writeGoldenPinStore(data) {
  const safe = {
    ...emptyGoldenPinStore(),
    ...data,
    data: Array.isArray(data.data) ? data.data : []
  };
  writeJsonFile(GOLDEN_PIN_FILE, safe);
  return safe;
}

module.exports = {
  readGoldenPinStore,
  writeGoldenPinStore,
  emptyGoldenPinStore
};
