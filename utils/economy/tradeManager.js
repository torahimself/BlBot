const activeTrades = new Map();

class Trade {
  constructor(initiatorId, targetId, initiatorOffer) {
    // Use a clean numeric-only ID so it won't break when embedded in button customIds split by '_'
    this.id = `${Date.now()}${Math.floor(Math.random() * 100000)}`;
    this.initiatorId = initiatorId;
    this.targetId = targetId;
    this.initiatorOffer = initiatorOffer;
    this.targetOffer = null;
    this.initiatorConfirmed = false;
    this.targetConfirmed = false;
    this.createdAt = Date.now();
    this.timeout = setTimeout(() => this.cancel('Trade timed out after 2 minutes.'), 120000);
  }

  cancel(reason) {
    clearTimeout(this.timeout);
    activeTrades.delete(this.id);
  }

  setTargetOffer(offer) {
    this.targetOffer = offer;
  }

  confirm(userId) {
    if (userId === this.initiatorId) this.initiatorConfirmed = true;
    else if (userId === this.targetId) this.targetConfirmed = true;

    if (this.initiatorConfirmed && this.targetConfirmed) {
      clearTimeout(this.timeout);
      activeTrades.delete(this.id);
      return true;
    }
    return false;
  }
}

function createTrade(initiatorId, targetId, initiatorOffer) {
  const trade = new Trade(initiatorId, targetId, initiatorOffer);
  activeTrades.set(trade.id, trade);
  return trade;
}

function getTrade(tradeId) {
  return activeTrades.get(tradeId);
}

function cancelTrade(tradeId, reason) {
  const trade = activeTrades.get(tradeId);
  if (trade) trade.cancel(reason);
}

module.exports = { activeTrades, createTrade, getTrade, cancelTrade };
