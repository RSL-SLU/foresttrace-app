import {
  AI_FIRST_YEAR, AI_STATUS_LEGEND, STATUS_COLORS, SCAR_RAMP, BIOMASS_RAMP, BIOMASS_MAX,
  rampCss, scanfiSnapshot,
} from '../utils/borealLayers';
import { CARIBOU_VISIBLE_CLASSES, caribouClassesFor } from '../utils/caribouClasses';
import { ALERT_AGE_BUCKETS, ageColor } from '../utils/alerts';
import { wildfireColorFor } from '../utils/wildfireClasses';
import { LAG_CLASSES } from '../utils/reportingLag';

// The original biomass-density PNGs, low to high (was a vertical bar in BiomassModule)
const BIOMASS_DENSITY_GRADIENT = 'linear-gradient(90deg, rgb(220,180,140) 0%, rgb(255,120,0) 8%, '
  + 'rgb(255,190,0) 19%, rgb(255,255,0) 30%, rgb(50,220,0) 41%, rgb(0,255,0) 63%, '
  + 'rgb(0,200,0) 89%, rgb(0,100,0) 100%)';

function Swatch({ color, outline = false, line = null }) {
  if (line) return <span className={`alert-legend-line${line === 'dashed' ? ' alert-legend-line--dashed' : ''}`} />;
  return (
    <span
      className={`legend-color${outline ? ' status-outline' : ''}`}
      style={outline ? { borderColor: color } : { background: color }}
    />
  );
}

function Item({ children, ...swatch }) {
  return (
    <div className="map-legend-item">
      <Swatch {...swatch} />
      <span>{children}</span>
    </div>
  );
}

function Ramp({ background, labels }) {
  return (
    <>
      <div className="map-legend-ramp" style={{ background }} />
      <div className="map-legend-ramp-labels">
        {labels.map((l) => <span key={l}>{l}</span>)}
      </div>
    </>
  );
}

/**
 * One legend for everything drawn on the map, docked in the bottom-right
 * corner above the Sources button. Module panels keep stats and settings; the
 * key to the colours lives with the map, and lists only layers that are on.
 *
 * `layers` is the effective { moduleId: layerId[] } the map renders from.
 */
function MapLegend({
  layers, year, minConfidence, onMinConfidenceChange, scarsPersistentOnly, fieldSitesOn = false, lagOn = false, caribouSingleHue = false, basemapMode = 'light',
}) {
  const on = (moduleId, layerId) => (layers[moduleId] || []).includes(layerId);
  const sections = [];

  const ariAcc = on('clearcut', 'clearcut-accumulated');
  const ariAnnual = on('clearcut', 'clearcut-annual');
  const ai = on('clearcut', 'clearcut-ml-accumulated') || on('clearcut', 'clearcut-ml-annual');
  if (ariAcc || ariAnnual) {
    sections.push(
      <div className="map-legend-group" key="ari">
        <p className="map-legend-heading">Clearcuts · Official Inventory (ARI)</p>
        {ariAcc && <Item color="#d97706">Accumulated (5-year window)</Item>}
        {ariAnnual && <Item color="#dc2626">Annual (harvested this year)</Item>}
      </div>,
    );
  }
  if (ai) {
    const beforeAi = year && Number(year) < AI_FIRST_YEAR;
    sections.push(
      <div className="map-legend-group" key="ai">
        <p className="map-legend-heading">Clearcuts · AI Model Estimates (outlines)</p>
        {beforeAi ? (
          <p className="map-legend-note">
            AI detections start in {AI_FIRST_YEAR}; {year} shows official harvest records only.
          </p>
        ) : (
          <>
            {AI_STATUS_LEGEND.map(({ status, label }) => (
              <Item key={status} outline color={`rgb(${STATUS_COLORS[status].join(',')})`}>{label}</Item>
            ))}
            <div className="map-legend-confidence">
              <label htmlFor="ai-min-confidence">
                Hide provisional below <strong>{minConfidence}%</strong> confidence
              </label>
              <input
                id="ai-min-confidence"
                type="range"
                min="0"
                max="90"
                step="10"
                value={minConfidence}
                onChange={(e) => onMinConfidenceChange(Number(e.target.value))}
              />
              <small>Provisional outlines fade with confidence; confirmed ones always show. Click a stand to read its status.</small>
            </div>
          </>
        )}
      </div>,
    );
  }
  if (on('clearcut', 'logging-scars')) {
    sections.push(
      <div className="map-legend-group" key="scars">
        <p className="map-legend-heading">Logging scars · biomass vs same-age stands</p>
        <Ramp background={rampCss(SCAR_RAMP)} labels={['0 (worst)', '0.25', '0.5']} />
        <p className="map-legend-note-muted">
          {scarsPersistentOnly
            ? 'Showing stands flagged at 2+ snapshots only.'
            : 'Lighter: flagged at one snapshot only, which may be a transient bad year.'}
        </p>
        <p className="map-legend-note-muted">
          SCANFI-based estimate for stands cut 2002–2010 only; independent of, and not a validation of, the Wildlands League field sites.
        </p>
      </div>,
    );
  }

  if (lagOn) {
    sections.push(
      <div className="map-legend-group" key="lag">
        <p className="map-legend-heading">Reporting lag · seen by AI before the harvest record</p>
        {LAG_CLASSES.map((c) => <Item key={c.label} color={c.color}>{c.label}</Item>)}
      </div>,
    );
  }

  if (fieldSitesOn) {
    sections.push(
      <div className="map-legend-group" key="field-sites">
        <p className="map-legend-heading">Field-verified logging scars</p>
        <div className="map-legend-item"><span className="legend-site legend-site--selected" /><span>Selected sample site</span></div>
        <div className="map-legend-item"><span className="legend-site" /><span>Candidate study site</span></div>
        <p className="map-legend-note-muted">Wildlands League (loggingscars.ca): roads and landings left barren by clearcut logging.</p>
      </div>,
    );
  }

  if (on('wildfire', 'wildfire-burned')) {
    sections.push(
      <div className="map-legend-group" key="wildfire">
        <p className="map-legend-heading">Wildfire</p>
        <Item color={wildfireColorFor(basemapMode)}>Burned area (NBAC)</Item>
      </div>,
    );
  }

  if (on('biomass', 'biomass-scanfi')) {
    sections.push(
      <div className="map-legend-group" key="scanfi">
        <p className="map-legend-heading">Biomass (SCANFI) · {scanfiSnapshot(Number(year) || 2025)} snapshot</p>
        <Ramp background={rampCss(BIOMASS_RAMP)} labels={['0', String(BIOMASS_MAX / 2), `${BIOMASS_MAX}+ t/ha`]} />
      </div>,
    );
  }
  if (on('biomass', 'biomass-density')) {
    sections.push(
      <div className="map-legend-group" key="biomass-density">
        <p className="map-legend-heading">Biomass density (AGB)</p>
        <Ramp background={BIOMASS_DENSITY_GRADIENT} labels={['0', '~70', '135 Mg/ha']} />
      </div>,
    );
  }

  if (on('wildlife', 'caribou-habitat')) {
    sections.push(
      <div className="map-legend-group" key="caribou">
        <p className="map-legend-heading">Caribou core habitat · patch size</p>
        {CARIBOU_VISIBLE_CLASSES.map((c) => {
          const cls = caribouClassesFor(caribouSingleHue)[c];
          return <Item key={c} color={cls.color}>{cls.name}</Item>;
        })}
      </div>,
    );
  }

  if (on('alerts', 'disturbance-alerts')) {
    sections.push(
      <div className="map-legend-group" key="alerts">
        <p className="map-legend-heading">Disturbance alerts · age</p>
        {ALERT_AGE_BUCKETS.map((b) => (
          <Item key={b.label} color={ageColor(b.maxDays === Infinity ? 999 : b.maxDays)}>{b.label}</Item>
        ))}
        <Item line="solid">Confirmed (repeated vegetation loss)</Item>
        <Item line="dashed">Provisional (seen once or twice)</Item>
      </div>,
    );
  }

  if (sections.length === 0) return null;

  return (
    <details className="map-legend" open>
      <summary className="map-legend-summary">Legend</summary>
      <div className="map-legend-body">{sections}</div>
    </details>
  );
}

export default MapLegend;
