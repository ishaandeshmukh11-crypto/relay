// Lets other TWWIOS products listen to inbound customer messages without circular imports.
export const hooks = { inbound: null }; // set by saathi/engine.js: async ({orgId, channel, senderId, name, text}) => { reply } | null
