/* Shared fixtures for the offline nearest-city lookup.
 *
 * Coordinates are published city/town-centre locations, independent of the
 * GeoNames dump, so the test does not simply echo the data it is checking.
 * Every expected place is verified to exist in cities15000 (see
 * tests/tune.js --audit); places below the dataset's population floor are not
 * testable and must not be listed here.
 *
 * "|" separates accepted alternatives ("Bangalore|Bengaluru").
 */
"use strict";

/* Major cities: the lookup should recognise the city you are standing in,
 * even where GeoNames' stored centroid for that city is imprecise. */
const cities = [
  ["Amsterdam", 52.3676, 4.9041], ["Rotterdam", 51.9244, 4.4777],
  ["Brussels", 50.8476, 4.3572], ["Paris", 48.8566, 2.3522],
  ["Lyon", 45.7640, 4.8357], ["Berlin", 52.5200, 13.4050],
  ["Munich", 48.1351, 11.5820], ["Hamburg", 53.5511, 9.9937],
  ["Vienna", 48.2082, 16.3738], ["Zurich", 47.3769, 8.5417],
  ["Rome", 41.9028, 12.4964], ["Milan", 45.4642, 9.1900],
  ["Madrid", 40.4168, -3.7038], ["Barcelona", 41.3874, 2.1686],
  ["Lisbon", 38.7223, -9.1393], ["London", 51.5074, -0.1278],
  ["Manchester", 53.4808, -2.2426], ["Edinburgh", 55.9533, -3.1883],
  ["Dublin", 53.3498, -6.2603], ["Copenhagen", 55.6761, 12.5683],
  ["Stockholm", 59.3293, 18.0686], ["Oslo", 59.9139, 10.7522],
  ["Helsinki", 60.1699, 24.9384], ["Reykjavik", 64.1466, -21.9426],
  ["Warsaw", 52.2297, 21.0122], ["Prague", 50.0755, 14.4378],
  ["Budapest", 47.4979, 19.0402], ["Athens", 37.9838, 23.7275],
  ["Istanbul", 41.0082, 28.9784], ["Moscow", 55.7558, 37.6173],
  ["Kyiv", 50.4501, 30.5234], ["New York", 40.7128, -74.0060],
  ["Chicago", 41.8781, -87.6298], ["Los Angeles", 34.0522, -118.2437],
  ["San Francisco", 37.7749, -122.4194], ["Seattle", 47.6062, -122.3321],
  ["Denver", 39.7392, -104.9903], ["Austin", 30.2672, -97.7431],
  ["Miami", 25.7617, -80.1918], ["Boston", 42.3601, -71.0589],
  ["Toronto", 43.6532, -79.3832], ["Vancouver", 49.2827, -123.1207],
  ["Montreal", 45.5017, -73.5673], ["Mexico City", 19.4326, -99.1332],
  ["Bogota", 4.7110, -74.0721], ["Lima", -12.0464, -77.0428],
  ["Santiago", -33.4489, -70.6693], ["Buenos Aires", -34.6037, -58.3816],
  ["Sao Paulo", -23.5505, -46.6333], ["Rio de Janeiro", -22.9068, -43.1729],
  ["Cairo", 30.0444, 31.2357], ["Lagos", 6.5244, 3.3792],
  ["Nairobi", -1.2921, 36.8219], ["Cape Town", -33.9249, 18.4241],
  ["Johannesburg", -26.2041, 28.0473], ["Dubai", 25.2048, 55.2708],
  ["Mumbai", 19.0760, 72.8777], ["Delhi", 28.6139, 77.2090],
  ["Bangalore|Bengaluru", 12.9716, 77.5946], ["Bangkok", 13.7563, 100.5018],
  ["Singapore", 1.3521, 103.8198], ["Jakarta", -6.2088, 106.8456],
  ["Manila", 14.5995, 120.9842], ["Hong Kong", 22.3193, 114.1694],
  ["Tokyo", 35.6762, 139.6503], ["Osaka", 34.6937, 135.5023],
  ["Seoul", 37.5665, 126.9780], ["Beijing", 39.9042, 116.4074],
  ["Shanghai", 31.2304, 121.4737], ["Sydney", -33.8688, 151.2093],
  ["Melbourne", -37.8136, 144.9631], ["Auckland", -36.8485, 174.7633],
  ["Wellington", -41.2865, 174.7762],
];

/* Smaller towns that ARE in the dataset. These are the guard against tuning
 * that over-favours large cities and misnames rural locations. Each must have a
 * dataset entry of the expected name within ~50 km of the given coordinates —
 * tests/tune.js enforces this, because a same-named place on another continent
 * (Keswick, Ontario; Queenstown, South Africa) looks like a pass to a name-only
 * check while actually testing nothing. */
const towns = [
  ["Barrow in Furness", 54.1089, -3.2267],
  ["Inverness", 57.4778, -4.2247], ["Bend", 44.0582, -121.3153],
  ["Bozeman", 45.6770, -111.0429], ["Traverse City", 44.7631, -85.6206],
  ["Ithaca", 42.4440, -76.5019], ["Leiden", 52.1601, 4.4970],
  ["Delft", 52.0116, 4.3571], ["Groningen", 53.2194, 6.5665],
  ["Nelson", -41.2706, 173.2840],
  ["Puerto Natales", -51.7260, -72.5050], ["Biarritz", 43.4832, -1.5586],
  ["Siem Reap", 13.3671, 103.8448], ["Luang Prabang", 19.8860, 102.1350],
  ["Hoi An", 15.8801, 108.3380], ["Ubud", -8.5069, 115.2625],
  ["Essaouira", 31.5085, -9.7595], ["Chefchaouen", 35.1688, -5.2636],
];

module.exports = { cities, towns };
