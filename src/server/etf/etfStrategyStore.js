const { ETF_STRATEGY_FILE } = require("../config");
const { readJsonFile, writeJsonFile } = require("../storage/jsonStore");

function emptyEtfStrategyStore() {
  return {
    status: "idle",
    refreshedAt: "",
    listUpdatedAt: "",
    etfs: [],
    mediumTop5: [],
    shortTop5: []
  };
}

function readEtfStrategyStore() {
  return readJsonFile(ETF_STRATEGY_FILE, emptyEtfStrategyStore());
}

function writeEtfStrategyStore(data) {
  const safe = {
    ...emptyEtfStrategyStore(),
    ...data,
    mediumTop5: Array.isArray(data.mediumTop5) ? data.mediumTop5 : [],
    shortTop5: Array.isArray(data.shortTop5) ? data.shortTop5 : [],
    etfs: Array.isArray(data.etfs) ? data.etfs : []
  };
  writeJsonFile(ETF_STRATEGY_FILE, safe);
  return safe;
}

module.exports = {
  readEtfStrategyStore,
  writeEtfStrategyStore,
  emptyEtfStrategyStore
};
