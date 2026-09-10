import mongoose from 'mongoose';

// One cached city per repo (keyed by a normalized repo identity).
//
// The city JSON is stored GZIPPED as a Buffer: MongoDB caps a document at
// 16 MB, and a large repo's raw JSON can approach that. Gzip buys ~10x
// headroom and keeps reads cheap.
const CitySchema = new mongoose.Schema({
  key: { type: String, unique: true, index: true },
  repo: String,
  headSha: String,
  dataGz: Buffer,
  bytes: Number, // uncompressed size, for diagnostics
  createdAt: { type: Date, default: Date.now },
});

export const City = mongoose.model('City', CitySchema);
