// MongoDB connection. Caching is OPTIONAL — if Mongo isn't reachable the API
// still works, just without persisting analyzed cities between requests.

import mongoose from 'mongoose';

let connected = false;

export async function connectDb(uri) {
  if (!uri) return false;
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 2500 });
    connected = true;
    console.log('[db] connected to MongoDB');
  } catch (e) {
    connected = false;
    console.warn(`[db] MongoDB unavailable — running without cache (${e.message})`);
  }
  return connected;
}

export const isDbConnected = () => connected;
