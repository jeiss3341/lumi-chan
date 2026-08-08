// Central place for colors + assets so the panel and cards stay consistent.
module.exports = {
  COLORS: {
    brand: 0x39c5f2, // panel / brand accent — vivid ocean blue
    pending: 0x39c5f2, // same ocean blue while awaiting review
    approved: 0x1abc9c, // tropical turquoise, reads as "good to go"
    denied: 0xff6b6b, // coral red, still unmistakably "no"
    claimed: 0x576574, // charcoal, echoes the checkered flag once it's done
  },

  // Banner shown inside bounty card embeds (renders once, no duplicate).
  BANNER_URL: 'https://i.imgur.com/4k7eFBF.jpeg',
};