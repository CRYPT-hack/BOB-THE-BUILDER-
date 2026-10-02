import mongoose from 'mongoose';

// One cached city per repo (keyed by a normalized repo identity).
//
// The city JSON is stored GZIPPED as a Buffer: MongoDB caps a document at
// 16 MB, and a large repo's raw JSON can approach that. Gzip buys ~10x
// headroom and keeps reads cheap.
// Bump when the city JSON gains or changes fields. Cached cities built by an
// older engine are then rebuilt instead of served to a UI expecting data they
// don't carry.
export const CITY_SCHEMA = 2;

const CitySchema = new mongoose.Schema({
  key: { type: String, unique: true, index: true },
  schema: Number,
  repo: String,
  headSha: String,
  dataGz: Buffer,
  bytes: Number, // uncompressed size, for diagnostics
  createdAt: { type: Date, default: Date.now },
});

export const City = mongoose.model('City', CitySchema);
