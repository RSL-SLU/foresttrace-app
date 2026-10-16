/**
 * The wildfire layer's own class table.
 *
 * NBAC gives burn perimeters, not a classification, so there is exactly one
 * meaningful value: the rasteriser writes 1 for burned and leaves 0 as nodata.
 *
 * Deliberately not clearcut's taxonomy. An earlier version wrote burned pixels as
 * that model's class 3 (`fire`), which worked but numbered this layer by a model
 * it has no relationship to.
 *
 * The colour here is the fallback; the layer passes its own through
 * colorOverrides.
 */

export const WILDFIRE_CLASSES = {
  0: { name: 'unburned', color: null }, // nodata -- always transparent
  // Colour follows the basemap (wildfireColorFor); alpha is shared
  1: { name: 'burned', color: '#292524', alpha: 200 },
};

/**
 * Burned-area colour for the current basemap. No single colour works on both
 * and stays clear of the other modules (clearcut amber/red, alerts
 * pink/violet): charcoal reads on the light map but vanishes into dark forest
 * on imagery, and yellow is the reverse.
 */
export const WILDFIRE_COLORS = { light: '#292524', satellite: '#facc15' };

export function wildfireColorFor(basemapMode) {
  return WILDFIRE_COLORS[basemapMode] || WILDFIRE_COLORS.light;
}

/** The burned class -- the one the layer's own color overrides. */
export const WILDFIRE_CLASS_ID = 1;

/** Only one class exists, so it is also the default view. */
export const WILDFIRE_VISIBLE_CLASSES = [WILDFIRE_CLASS_ID];
