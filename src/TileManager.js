/**
 * Api methods used in control and layer
 * For advanced usage
 * ```js
 * import * from 'leaflet.offline/TileManager';
 * ```
 * @module TileManager
 *
 */

import L from 'leaflet';
import { openDB, deleteDB } from 'idb';

const tileStoreName = 'tileStore';
const urlTemplateIndex = 'urlTemplate';

const dbPromise = openDB('leaflet.offline', 2, {
  upgrade(db, oldVersion) {
    deleteDB('leaflet_offline');
    deleteDB('leaflet_offline_areas');

    if (oldVersion < 1) {
      const tileStore = db.createObjectStore(tileStoreName, {
        keyPath: 'key',
      });
      tileStore.createIndex(urlTemplateIndex, 'urlTemplate');
      tileStore.createIndex('z', 'z');
    }
  },
});

/**
 *
 * @typedef {Object} tileInfo
 * @property {string} key storage key
 * @property {string} url resolved url
 * @property {string} urlTemplate orig url, used to find tiles per layer
 * @property {string} x left point of tile
 * @property {string} y top point coord of tile
 * @property {string} z tile zoomlevel
 */

/**
 * @return {Promise<Number>} get number of store tiles
 */
export async function getStorageLength() {
  return (await dbPromise).count(tileStoreName);
}

/**
 * @example
 * getStorageInfo('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png')
 *
 * @param {string} urlTemplate
 *
 * @return {Promise<tileInfo[]>}
 */
export async function getStorageInfo(urlTemplate) {
  const range = IDBKeyRange.only(urlTemplate);
  return (await dbPromise).getAllFromIndex(
    tileStoreName,
    urlTemplateIndex,
    range,
  );
}

/**
 * @example
 * downloadTile(tileInfo.url).then(blob => saveTile(tileInfo, blob))
 *
 * @param {string} tileUrl
 * @return {Promise<blob>}
 */
export async function downloadTile(tileUrl) {
  return fetch(tileUrl).then((response) => {
    if (!response.ok) {
      throw new Error(`Request failed with status ${response.statusText}`);
    }
    return response.blob();
  });
}
/**
 * TODO validate tileinfo props?
 *
 * @example
 * saveTile(tileInfo, blob).then(() => console.log(`saved tile from ${tileInfo.url}`))
 *
 * @param {tileInfo} tileInfo
 * @param {Blob} blob
 *
 * @return {Promise}
 */
export async function saveTile(tileInfo, blob) {
  return (await dbPromise).put(tileStoreName, {
    blob,
    ...tileInfo,
  });
}

/**
 *
 * @param {string} urlTemplate
 * @param {object} data  x, y, z, s
 * @param {string} data.s subdomain
 *
 * @returns {string}
 */
export function getTileUrl(urlTemplate, data) {
  return L.Util.template(urlTemplate, {
    ...data,
    r: L.Browser.retina ? '@2x' : '',
  });
}
/**
 * @example
 * const p1 = L.point(10, 10)
 * const p2 = L.point(40, 60)
 * getTileUrls(layer, L.bounds(p1,p2), 12)
 *
 * @param {object} layer leaflet tilelayer
 * @param {object} bounds L.bounds
 * @param {number} zoom zoomlevel 0-19
 * @param {L.CRS} [crs] to calculate the world pixel bounds for TMS scheme
 *
 * @return {Array.<tileInfo>}
 */
export function getTileUrls(layer, bounds, zoom, crs = L.CRS.EPSG3857) {
  const tiles = [];
  const tileBounds = L.bounds(
    bounds.min.divideBy(layer.getTileSize().x).floor(),
    bounds.max.divideBy(layer.getTileSize().x).floor(),
  );
  const worldTileBounds = layer._pxBoundsToTileRange(crs.getProjectedBounds(zoom));
  for (let j = tileBounds.min.y; j <= tileBounds.max.y; j += 1) {
    for (let i = tileBounds.min.x; i <= tileBounds.max.x; i += 1) {
      const x = i;
      let y = j;
      // invert y coordinate for TMS tile schemes
      const invertedY = worldTileBounds.max.y - y;
      if (layer.options.tms) {
        y = invertedY;
      }
      const tilePoint = new L.Point(i, y);
      const data = {
        ...layer.options, x, y, z: zoom,
      };
      tiles.push({
        key: getTileUrl(layer._url, {
          ...data,
          s: layer.options.subdomains['0'],
        }),
        url: getTileUrl(layer._url, {
          ...data,
          s: layer._getSubdomain(tilePoint),
        }),
        z: zoom,
        x,
        y,
        urlTemplate: layer._url,
        '-y': invertedY,
      });
    }
  }

  return tiles;
}
/**
 * Get a geojson of tiles from one resource
 *
 * @example
 * const urlTemplate = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
 * const getGeoJsonData = () => LeafletOffline.getStorageInfo(urlTemplate)
 *  .then((data) => LeafletOffline.getStoredTilesAsJson(baseLayer, data));
 *
 * getGeoJsonData().then((geojson) => {
 *   storageLayer = L.geoJSON(geojson).bindPopup(
 *     (clickedLayer) => clickedLayer.feature.properties.key,
 *   );
 * });
 *
 * @param {object} layer
 * @param {tileInfo[]} tiles
 *
 * @return {object} geojson
 */
export function getStoredTilesAsJson(layer, tiles, crs = L.CRS.EPSG3857) {
  const featureCollection = {
    type: 'FeatureCollection',
    features: [],
  };
  const tileSize = layer.getTileSize();
  for (let i = 0; i < tiles.length; i += 1) {
    const tile = tiles[i];
    let { y } = tile;
    const { x, z: zoom } = tile;
    const worldTileBounds = layer._pxBoundsToTileRange(
      crs.getProjectedBounds(zoom),
    );
    if (layer.options.tms) {
      const invertedY = worldTileBounds.max.y - y;
      y = invertedY;
    }

    const topLeftPoint = new L.Point(x * tileSize.x, y * tileSize.y);
    const bottomRightPoint = new L.Point(
      topLeftPoint.x + tileSize.x,
      topLeftPoint.y + tileSize.y,
    );

    const topLeftlatlng = crs.pointToLatLng(topLeftPoint, zoom);
    const botRightlatlng = crs.pointToLatLng(bottomRightPoint, zoom);
    featureCollection.features.push({
      type: 'Feature',
      properties: tile,
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [topLeftlatlng.lng, topLeftlatlng.lat],
            [botRightlatlng.lng, topLeftlatlng.lat],
            [botRightlatlng.lng, botRightlatlng.lat],
            [topLeftlatlng.lng, botRightlatlng.lat],
            [topLeftlatlng.lng, topLeftlatlng.lat],
          ],
        ],
      },
    });
  }

  return featureCollection;
}

/**
 * Remove tile by key
 * @param {string} key
 *
 * @returns {Promise}
 */
export async function removeTile(key) {
  return (await dbPromise).delete(tileStoreName, key);
}

/**
 * Get single tile blob
 *
 * @param {string} key
 *
 * @returns {Promise<Blob>}
 */
export async function getTile(key) {
  return (await dbPromise).get(tileStoreName, key).then((result) => result.blob);
}

/**
 * Remove everything
 *
 * @return {Promise}
 */
export async function truncate() {
  return (await dbPromise).clear(tileStoreName);
}
