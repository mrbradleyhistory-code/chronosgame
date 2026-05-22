import type { HexCell, HexMapData, TerrainType } from './hexUtils'

// ─── local seed / resource helpers (mirrors mapGen internals) ─────────────────

function strToSeed(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) }
  return h >>> 0
}
function hash2(x: number, y: number, seed: number): number {
  let h = seed ^ (x * 1000003) ^ (y * 1000033)
  h = Math.imul(h ^ (h >>> 16), 2246822519)
  h = Math.imul(h ^ (h >>> 13), 3266489917)
  return (h ^ (h >>> 16)) >>> 0
}
function rand01(x: number, y: number, seed: number) { return hash2(x, y, seed) / 4294967296 }

const RES_BY_TERRAIN: Record<TerrainType, (string | null)[]> = {
  plains:   ['wheat','wheat','wheat','iron'],
  forest:   ['wood','wood','wood','gems'],
  hills:    ['stone','stone','iron','gold','gems'],
  desert:   ['gold','stone','gems'],
  coast:    ['fish','fish','gold'],
  river:    ['fish','fish','wheat'],
  mountain: ['stone','iron','gold','gems'],
  lake:     ['fish','fish','fish'],
  jungle:   ['wood','wood','gems'],
  steppe:   ['wheat','iron'],
  tundra:   ['stone','gems'],
}
const RES_CHANCE: Record<TerrainType, number> = {
  plains:0.25, forest:0.35, hills:0.40, desert:0.15, coast:0.35,
  river:0.30, mountain:0.35, lake:0.50, jungle:0.30, steppe:0.20, tundra:0.12,
}
function placeResource(terrain: TerrainType, q: number, r: number, seed: number): string | null {
  if (rand01(q, r, seed + 700) > RES_CHANCE[terrain]) return null
  const opts = RES_BY_TERRAIN[terrain]
  return opts[Math.floor(rand01(q, r, seed + 800) * opts.length)]
}

// ─── grid painter ─────────────────────────────────────────────────────────────

// Single-char terrain codes
const CODES: Record<string, TerrainType> = {
  '.':'coast', 'p':'plains', 'f':'forest', 'h':'hills',
  'd':'desert', 'm':'mountain', 'l':'lake', 'j':'jungle',
  's':'steppe', 't':'tundra',  'r':'river',
}

type Grid = string[][]

function mkGrid(rows: number, cols: number, fill = '.'): Grid {
  return Array.from({ length: rows }, () => Array(cols).fill(fill))
}
function fr(g: Grid, r1: number, r2: number, q1: number, q2: number, t: string) {
  for (let r = Math.max(0,r1); r <= Math.min(g.length-1,r2); r++)
    for (let q = Math.max(0,q1); q <= Math.min(g[0].length-1,q2); q++)
      g[r][q] = t
}
function fe(g: Grid, cr: number, cq: number, rr: number, rq: number, t: string) {
  for (let r = 0; r < g.length; r++)
    for (let q = 0; q < g[0].length; q++)
      if (((r-cr)/rr)**2 + ((q-cq)/rq)**2 <= 1) g[r][q] = t
}
function fc(g: Grid, cells: [number, number][], t: string) {  // [q, r]
  for (const [q, r] of cells)
    if (r >= 0 && r < g.length && q >= 0 && q < g[0].length) g[r][q] = t
}

function toHexMap(g: Grid, cols: number, rows: number, seed: string): HexMapData {
  const s = strToSeed(seed)
  const cells: HexCell[] = []
  for (let r = 0; r < rows; r++)
    for (let q = 0; q < cols; q++) {
      const terrain = CODES[g[r]?.[q] ?? '.'] ?? 'coast'
      cells.push({ q, r, terrain, resource: placeResource(terrain, q, r, s) as TerrainType | null, owner: null, explored_by: [] })
    }
  return { cols, rows, cells }
}

// ─── map builders ─────────────────────────────────────────────────────────────

function buildMediterranean(): HexMapData {
  // 30×20 — 10°W→42°E, 57°N→25°N
  const g = mkGrid(20, 30, '.')

  // --- Northern Europe ---
  fr(g, 0, 3, 0, 29, 'f')           // Forest blanket across N.Europe
  fr(g, 0, 5, 0, 6,  'h')           // Iberian Peninsula
  fr(g, 0, 2, 0, 3,  'p')           // Portugal / Galicia
  fr(g, 3, 7, 0, 5,  's')           // Castile steppe
  fr(g, 0, 4, 4, 10, 'p')           // French / Rhine plains
  fr(g, 3, 4, 3, 6,  'm')           // Pyrenees
  fr(g, 1, 3, 9, 13, 'm')           // Alps
  fr(g, 2, 4, 10, 12,'p')           // Po valley (N Italy)
  fr(g, 0, 6, 14, 18,'h')           // Balkans
  fr(g, 0, 2, 14, 18,'p')           // Pannonian plains
  fr(g, 0, 6, 19, 25,'s')           // Anatolia steppe
  fr(g, 0, 2, 19, 24,'h')           // Anatolian plateau
  fr(g, 2, 5, 19, 24,'m')           // Taurus / Pontic mountains
  fr(g, 0, 4, 25, 29,'m')           // Caucasus / Zagros
  fr(g, 3, 7, 25, 29,'s')           // Syrian steppe

  // --- Mediterranean Sea (punch through land) ---
  fr(g, 7, 13, 4, 24, '.')
  fr(g, 5,  8, 6, 23, '.')          // Widen upper Med
  fr(g, 0,  4, 0,  1, '.')          // Atlantic left edge
  fr(g, 5, 19, 0,  1, '.')
  fr(g, 4, 10,13, 15, '.')          // Adriatic
  fr(g, 6, 11,18, 21, '.')          // Aegean
  fr(g, 7, 11,15, 17, '.')          // Ionian
  fr(g, 0,  4,22, 26, '.')          // Black Sea
  fr(g, 0,  3,27, 29, '.')          // Caspian hint

  // --- Italian & Greek Peninsulas ---
  fr(g, 4, 12,10, 13, 'h')          // Italy
  fr(g, 7, 12,16, 18, 'h')          // Greece

  // --- Islands ---
  fe(g, 7, 9, 1.3, 1.0, 'h')        // Sardinia
  fe(g, 10,12, 1.3, 1.8, 'h')       // Sicily
  fe(g, 11,17, 1.0, 2.8, 'h')       // Crete
  fc(g, [[23,8],[24,8]], 'h')        // Cyprus

  // --- Levant / Near East ---
  fr(g, 5, 12,24, 26, 'p')          // Levant coast (Canaan / Syria)
  fr(g, 5, 12,26, 28, 's')          // Jordan / Syria steppe
  fr(g, 7, 19,27, 29, 'd')          // Arabian desert

  // --- North Africa ---
  fr(g, 13,15, 5, 22, 'p')          // Maghreb fertile coast
  fr(g, 14,16, 5, 21, 's')          // Transition steppe
  fr(g, 15,19, 0, 29, 'd')          // Sahara
  fr(g, 13,16,16, 22, 's')          // Libya
  fr(g, 11,17,23, 27, 'd')          // Eastern desert (Egypt flanks)
  fr(g, 11,16,24, 26, 'p')          // Nile valley / delta
  fc(g, [[25,11],[25,12],[25,13],[25,14],[24,15]], 'r') // Nile

  return toHexMap(g, 30, 20, 'preset-med')
}

function buildMiddleEast(): HexMapData {
  // 30×20 — ~28°E→65°E, ~42°N→17°N
  const g = mkGrid(20, 30, 'd')     // base: desert

  // --- Water bodies ---
  fr(g, 0,  4, 0,  4, '.')          // Black Sea / eastern Med
  fr(g, 0, 19, 0,  0, '.')          // Left edge (Med/Black Sea)
  fr(g, 12,19, 0,  8, '.')          // Red Sea
  fr(g, 12,19,22, 29, '.')          // Persian Gulf / Arabian Sea
  fr(g, 0,  4,25, 29, '.')          // Caspian Sea
  fe(g, 16, 14, 4, 7, '.')          // Gulf of Aden mouth

  // --- Mountain arcs ---
  fr(g, 0,  5, 0,  8, 'm')          // Taurus / Anatolian mountains
  fr(g, 0,  7, 0,  5, 's')          // Anatolian steppe (painted over)
  fr(g, 0,  5, 0,  5, 'm')          // Taurus core
  fr(g, 0,  6,23, 29, 'm')          // Zagros / Elburz mountains
  fr(g, 0,  4,25, 29, 'm')          // Caucasus fringe

  // --- Fertile Crescent ---
  fr(g, 3,  9, 2,  7, 'p')          // Anatolia / Syria plains
  fr(g, 5, 12, 6, 12, 'p')          // Levant / Syria
  fr(g, 6, 14,11, 18, 'p')          // Mesopotamia (Tigris/Euphrates)
  fc(g, [[9,6],[10,7],[10,8],[10,9],[10,10],[10,11],[11,12],[12,13]], 'r')  // Euphrates
  fc(g, [[13,6],[13,7],[13,8],[13,9],[13,10],[13,11],[13,12],[13,13]], 'r') // Tigris
  fr(g, 5,  9, 8, 11, 'p')          // Syria steppe → plains
  fr(g, 9, 15,14, 20, 'p')          // Lower Mesopotamia / Sumer
  fr(g, 14,17,15, 22, 's')          // Iraq transition

  // --- Persia / Iran plateau ---
  fr(g, 4, 14,18, 24, 's')          // Iranian plateau steppe
  fr(g, 8, 14,21, 27, 's')          // Persia core

  // --- Arabian Peninsula ---
  fr(g, 8, 19, 9, 22, 'd')          // Arabia (already desert, reinforce)
  fr(g, 12,19, 8, 14, 's')          // SW Arabia / Yemen highlands (steppe)
  fr(g, 13,18, 8, 12, 'h')          // Yemen/Hejaz mountains

  // --- Egypt / Nile ---
  fr(g, 8, 19, 0,  5, 'd')          // Eastern desert
  fr(g, 8, 17, 2,  4, 'p')          // Nile valley
  fc(g, [[3,8],[3,9],[3,10],[3,11],[3,12],[3,13],[3,14]], 'r') // Nile

  // --- Levant coast ---
  fr(g, 5, 12, 5,  7, 'p')          // Coastal plains (Canaan, Phoenicia)
  fr(g, 3,  7, 3,  6, 'h')          // Lebanon / Syrian mountains

  return toHexMap(g, 30, 20, 'preset-mideast')
}

function buildEurope(): HexMapData {
  // 30×22 — 10°W→45°E, 71°N→34°N  (land-base approach to avoid ocean gaps)
  const cols = 30, rows = 22
  const g = mkGrid(rows, cols, 'f')  // start with forest — punch water through

  // === LAND TERRAIN (refine from forest base) ===

  // --- Arctic tundra ---
  fr(g, 0,  3, 0, 29, 't')          // Top band: Arctic tundra
  fr(g, 3,  6, 5, 21, 't')          // Scandinavian tundra
  fr(g, 3,  7, 0,  4, 't')          // NW tundra (Iceland/Norway)

  // --- Scandinavia ---
  fr(g, 4,  9, 8, 14, 'f')          // Scandinavian forests
  fr(g, 3,  8, 8, 11, 'm')          // Norwegian mountains (spine)
  fr(g, 5,  9,11, 14, 'p')          // Swedish lowlands / Finland

  // --- British Isles ---
  fr(g, 5, 11, 3,  5, 'h')          // Scotland highlands
  fr(g, 7, 12, 3,  5, 'f')          // England / Wales forest
  fr(g, 8, 12, 2,  4, 'p')          // English lowlands
  fr(g, 7, 12, 1,  3, 'f')          // Ireland

  // --- Iberian Peninsula ---
  fr(g, 9, 17, 0,  6, 'h')          // Iberian hills
  fr(g, 9, 13, 0,  3, 'p')          // Portugal / Galicia
  fr(g,12, 17, 1,  5, 's')          // Castile / Extremadura steppe
  fr(g, 9, 11, 3,  6, 'm')          // Pyrenees

  // --- France / W. Germany ---
  fr(g, 8, 13, 5, 10, 'p')          // French plains
  fr(g, 7, 10, 7, 10, 'f')          // Normandy / NW France forest

  // --- Alps & Central Europe ---
  fr(g,10, 12, 9, 13, 'm')          // Alps
  fr(g, 9, 12,10, 13, 'p')          // Po valley / Bavaria
  fr(g, 6, 10,12, 20, 'f')          // Central/Eastern European forest
  fr(g, 9, 13,14, 19, 'p')          // Pannonian plain

  // --- Italian Peninsula ---
  fr(g,11, 19,10, 13, 'h')          // Italy
  fr(g,11, 13,11, 12, 'p')          // Po valley (reinforce)
  fr(g,12, 15,12, 14, 'm')          // Apennines

  // --- Balkans ---
  fr(g,10, 18,14, 20, 'h')          // Balkans
  fr(g,10, 13,15, 18, 'p')          // Pannonia (reinforce)
  fr(g,14, 19,17, 21, 'h')          // Greece / S.Balkans

  // --- Eastern Europe & Russia ---
  fr(g, 7, 16,21, 29, 's')          // Pontic / Eastern steppe
  fr(g, 5, 10,20, 25, 'f')          // Russian taiga (transition)
  fr(g, 7, 10,24, 29, 'f')          // Russian taiga (east)

  // --- Caucasus ---
  fr(g,14, 17,25, 29, 'm')          // Caucasus mountains
  fr(g,14, 18,22, 26, 's')          // Pontic steppe

  // === WATER (punch through land) ===
  // Atlantic & North Sea
  fr(g, 4, 21, 0,  0, '.')          // Left Atlantic edge
  fr(g, 4, 10, 0,  2, '.')          // Atlantic coast strip
  fr(g, 4,  8, 5,  8, '.')          // North Sea
  fr(g, 5, 10,14, 17, '.')          // Baltic Sea
  fr(g, 0,  3, 0, 29, '.')          // Arctic Ocean (reinforce top)

  // Mediterranean
  fr(g,17, 21, 5, 23, '.')          // Mediterranean Sea
  fr(g,16, 19,13, 16, '.')          // Adriatic
  fr(g,16, 20,18, 22, '.')          // Aegean
  fr(g,12, 16,22, 26, '.')          // Black Sea

  // British Isles coast (tiny water gaps)
  fr(g, 6, 12, 5,  6, '.')          // English Channel
  fr(g, 5,  8, 6,  8, '.')          // North Sea (reinforce)

  // Island features back on water
  fe(g, 9, 4, 4, 2, 'f')            // Great Britain (paint back)
  fr(g, 5, 11, 3,  5, 'h')          // Scotland (reinforce)
  fr(g, 7, 11, 1,  3, 'f')          // Ireland (paint back)

  // Italy (paint back onto Adriatic region)
  fr(g,11, 19,10, 13, 'h')          // Italy (reinforce)

  // Greek peninsula (paint back onto Aegean)
  fr(g,14, 19,16, 18, 'h')          // Greece (reinforce)

  return toHexMap(g, cols, rows, 'preset-europe')
}

function buildAmericas(): HexMapData {
  // 22×32 (portrait) — Americas from Alaska to Patagonia
  const cols = 22, rows = 32
  const g = mkGrid(rows, cols, '.')

  // === NORTH AMERICA ===
  // --- Arctic / Alaska ---
  fr(g, 0,  3, 2, 19, 't')          // Arctic tundra
  fr(g, 0,  4, 2,  6, 't')          // Alaska
  fr(g, 2,  5, 2,  5, 'f')          // Alaskan forest

  // --- Canada ---
  fr(g, 3,  7, 3, 19, 'f')          // Canadian boreal forest
  fr(g, 2,  5,15, 19, 't')          // Canadian tundra (east)
  fe(g, 5, 12, 3, 4, 'l')           // Great Lakes (ellipse)

  // --- Rocky Mountains ---
  fr(g, 3, 12, 3,  5, 'm')          // Rockies
  fr(g, 4,  9, 3,  4, 'm')          // Sierra Nevada

  // --- Great Plains ---
  fr(g, 6, 11, 6, 13, 's')          // Great Plains / prairies
  fr(g, 8, 11, 6,  9, 'p')          // Midwest agricultural plains

  // --- Eastern USA ---
  fr(g, 6, 12,13, 19, 'f')          // Eastern forests
  fr(g, 8, 11,10, 14, 'p')          // Mississippi valley

  // --- Appalachians ---
  fr(g, 7, 12,12, 13, 'h')          // Appalachians

  // --- SE USA / Gulf Coast ---
  fr(g, 10,12, 9, 16, 'p')          // Deep south / Gulf plains
  fr(g, 11,12,15, 18, 'f')          // SE coastal forest

  // --- Southwest / Desert ---
  fr(g, 9, 12, 4,  7, 'd')          // Sonoran / Mojave desert
  fr(g, 10,12, 5,  8, 's')          // Great Basin steppe

  // === MESOAMERICA ===
  fr(g, 12,15, 5, 15, 'j')          // Mesoamerican jungle
  fr(g, 12,14, 4,  6, 'm')          // Sierra Madre
  fr(g, 12,14, 6,  9, 'h')          // Mexican highlands
  fr(g, 13,15, 9, 13, 'p')          // Gulf coastal plains (Maya lowlands)

  // === CARIBBEAN / CENTRAL AMERICA ===
  fr(g, 14,17, 5, 16, 'j')          // Central American jungle
  fr(g, 14,16, 4,  6, 'm')          // Central American mountains
  fr(g, 15,17,14, 18, '.')          // Caribbean
  fe(g, 16,17, 1, 2, 'h')           // Cuba / Hispaniola hint

  // === SOUTH AMERICA ===
  // --- Andes ---
  fr(g, 16,28, 3,  5, 'm')          // Andes mountains
  fr(g, 17,22, 4,  5, 'm')          // Central Andes (Peru)

  // --- Pacific coast desert ---
  fr(g, 18,27, 2,  4, 'd')          // Atacama desert (Chile coast)
  fr(g, 16,20, 2,  3, 's')          // Peru coastal steppe

  // --- Amazon Basin ---
  fr(g, 16,24, 6, 16, 'j')          // Amazon jungle
  fr(g, 17,22, 5,  7, 'j')          // Western Amazon
  fr(g, 20,24,13, 16, 'j')          // Eastern Amazon

  // --- Brazilian Highlands ---
  fr(g, 22,27,10, 18, 'h')          // Brazilian plateau
  fr(g, 22,26,10, 14, 'p')          // Cerrado plains
  fr(g, 24,27,12, 17, 'f')          // Atlantic forest

  // --- Pampas / Patagonia ---
  fr(g, 25,30, 6, 16, 's')          // Pampas / steppe
  fr(g, 26,31, 4,  6, 's')          // Patagonia
  fr(g, 28,31, 5,  8, 't')          // Tierra del Fuego tundra

  // --- Venezuela / Orinoco ---
  fr(g, 16,20,12, 18, 'p')          // Llanos / Orinoco plains
  fr(g, 16,18,16, 19, 'h')          // Guiana highlands

  // --- Colombia / Caribbean coast ---
  fr(g, 15,18, 9, 14, 'j')          // N.Colombia jungle
  fr(g, 14,16,13, 16, 'p')          // Colombia / Venezuela coast

  // --- Rivers ---
  fc(g, [[10,17],[10,18],[10,19],[11,19],[12,19]], 'r') // Mississippi
  fc(g, [[11,21],[12,21],[13,20],[14,19],[15,18],[16,17],[17,16],[18,16],[19,16]], 'r') // Amazon

  return toHexMap(g, cols, rows, 'preset-americas')
}

function buildSouthAsia(): HexMapData {
  // 30×22 — ~55°E→105°E, ~40°N→5°N
  const cols = 30, rows = 22
  const g = mkGrid(rows, cols, '.')

  // --- Himalayas & Hindu Kush arc ---
  fr(g, 0,  4, 0, 29, 'm')          // Himalayan arc (top band)
  fr(g, 0,  3, 0,  8, 'm')          // Hindu Kush / Karakoram
  fr(g, 3,  5, 7, 20, 'm')          // Main Himalayan range
  fr(g, 0,  3, 0,  5, 's')          // Afghan steppe (over mountains at left)
  fr(g, 0,  2, 0,  4, 'm')          // Hindu Kush (reinforce)

  // --- Tibetan Plateau ---
  fr(g, 0,  4,15, 29, 'm')          // Tibet / Yunnan mountains
  fr(g, 0,  3,12, 20, 's')          // Tibetan plateau (steppe)

  // --- Indian Subcontinent ---
  // Indus valley
  fr(g, 4, 13, 5, 10, 'p')          // Indus / Punjab plains
  fr(g, 5, 12, 4,  6, 'p')          // Sind / Indus delta
  fc(g, [[6,5],[6,6],[6,7],[6,8],[6,9],[7,10],[7,11]], 'r') // Indus river

  // Thar Desert
  fr(g, 4, 12, 8, 11, 'd')          // Thar Desert

  // Ganges Plain
  fr(g, 4, 10,11, 20, 'p')          // Ganges / Doab plains
  fc(g, [[12,4],[12,5],[13,6],[13,7],[14,8],[14,9],[15,10],[16,11],[17,12],[18,13]], 'r') // Ganges

  // Deccan Plateau
  fr(g, 10,18,10, 19, 'h')          // Deccan plateau (hills)
  fr(g, 10,14,12, 17, 'p')          // Deccan plains (interior)

  // Western Ghats
  fr(g, 9, 19, 9, 11, 'm')          // Western Ghats mountains
  fr(g, 9, 18, 8, 10, 'f')          // Malabar coast forest

  // Eastern coast
  fr(g, 8, 18,18, 21, 'p')          // Coromandel / Orissa coast

  // Sri Lanka
  fe(g, 19,19, 2, 1.5, 'h')         // Sri Lanka

  // --- Afghanistan / Central Asia ---
  fr(g, 3, 10, 0,  6, 's')          // Afghan/Baloch steppe
  fr(g, 5, 10, 0,  4, 'h')          // Afghan highlands
  fr(g, 4,  8, 2,  5, 'm')          // Sulaiman mountains

  // --- SE Asia ---
  fr(g, 8, 16,21, 29, 'j')          // Indochina jungle
  fr(g, 5,  9,21, 29, 'f')          // Yunnan forest
  fr(g, 8, 14,22, 27, 'h')          // Indochina highlands
  fr(g, 12,18,23, 29, 'p')          // Mekong / Irrawaddy plains
  fc(g, [[23,10],[23,11],[23,12],[23,13],[23,14],[24,15],[24,16]], 'r') // Mekong

  // --- Bay of Bengal / Indian Ocean ---
  fr(g, 17,21,14, 22, '.')          // Bay of Bengal
  fr(g, 19,21, 9, 14, '.')          // S.India / Sri Lanka coast open

  // --- Arabian Sea ---
  fr(g, 12,21, 0,  5, '.')          // Arabian Sea
  fr(g, 17,21, 5,  9, '.')          // S.India coast open

  return toHexMap(g, cols, rows, 'preset-southasia')
}

function buildEastAsia(): HexMapData {
  // 30×22 — ~95°E→145°E, ~55°N→10°N
  const cols = 30, rows = 22
  const g = mkGrid(rows, cols, '.')

  // --- Siberia / Russian Far East ---
  fr(g, 0,  5, 0, 29, 't')          // Siberian tundra (top)
  fr(g, 3,  8, 0, 18, 'f')          // Siberian taiga
  fr(g, 5,  8,18, 28, 'f')          // Manchurian forest

  // --- Gobi Desert / Mongolian Steppe ---
  fr(g, 5, 10, 5, 18, 's')          // Mongolian steppe
  fr(g, 6, 11, 8, 16, 'd')          // Gobi Desert
  fr(g, 5,  8, 0,  7, 's')          // Kazakh steppe

  // --- Tibetan Plateau & Yunnan ---
  fr(g, 5, 13, 0,  7, 'm')          // Tibetan plateau mountains (west)
  fr(g, 8, 14, 5, 10, 'm')          // Kunlun / Qinling mountains
  fr(g, 10,15, 3,  7, 's')          // Tibetan plateau interior

  // --- Sichuan Basin ---
  fr(g, 11,14, 7, 10, 'p')          // Sichuan basin (red basin)
  fr(g, 10,12, 6,  9, 'h')          // Sichuan highlands rim

  // --- North China Plain ---
  fr(g, 8, 14,13, 20, 'p')          // North China plain
  fc(g, [[14,9],[14,10],[14,11],[14,12],[14,13],[15,14],[16,15]], 'r')  // Yellow River
  fc(g, [[11,12],[11,13],[12,14],[13,15],[13,16],[14,17]], 'r')          // Yangtze

  // --- South China ---
  fr(g, 14,19,10, 20, 'h')          // South China hills
  fr(g, 14,17,11, 15, 'f')          // Yangtze delta forests
  fr(g, 16,19,14, 19, 'j')          // Guangdong / S.China jungle

  // --- Manchuria / NE China ---
  fr(g, 7, 11,18, 24, 'p')          // Manchurian plain
  fr(g, 5,  9,22, 28, 'f')          // Ussuri forest

  // --- Korean Peninsula ---
  fr(g, 9, 16,22, 25, 'h')          // Korean peninsula (hills)
  fr(g, 10,14,23, 24, 'p')          // Korea plains

  // --- Japanese Archipelago ---
  fe(g, 8, 27, 4, 1, 'f')           // Hokkaido
  fr(g, 9, 17,26, 28, 'h')          // Honshu
  fr(g, 15,18,26, 27, 'h')          // Shikoku / Kyushu
  fr(g, 9, 14,26, 27, 'm')          // Japanese Alps

  // --- Southeast Asia ---
  fr(g, 17,22, 8, 22, 'j')          // Mainland SE Asia jungle
  fr(g, 16,20, 7, 11, 'h')          // Yunnan / Shan highlands
  fr(g, 17,21,12, 17, 'p')          // Mekong / Irrawaddy plains
  fr(g, 19,22,16, 22, 'j')          // Vietnam / Gulf of Tonkin
  fc(g, [[13,16],[13,17],[14,18],[14,19],[15,20],[15,21]], 'r') // Mekong

  // --- Maritime SE Asia ---
  fr(g, 19,21,20, 29, '.')          // South China Sea (open)
  fe(g, 21,24, 2, 4, 'j')           // Philippines hint
  fe(g, 20,29, 2, 5, 'j')           // Borneo / Sumatra hint

  // --- Pacific / Sea of Japan ---
  fr(g, 7, 22,28, 29, '.')          // Pacific edge
  fr(g, 8, 17,25, 26, '.')          // Sea of Japan

  return toHexMap(g, cols, rows, 'preset-eastasia')
}

// ─── public API ───────────────────────────────────────────────────────────────

export interface PresetMapMeta {
  id: string
  name: string
  description: string
  cols: number
  rows: number
  civHint: string
}

export const PRESET_MAPS: PresetMapMeta[] = [
  { id:'mediterranean', name:'Mediterranean Basin',  description:'Greece, Rome, Egypt, Carthage, Persia',    cols:30, rows:20, civHint:'6–8 civs'  },
  { id:'middle-east',   name:'Middle East',           description:'Mesopotamia, Levant, Arabia, Persia',     cols:30, rows:20, civHint:'6–8 civs'  },
  { id:'europe',        name:'Europe',                description:'Rome, Celts, Germans, Vikings, Slavs',    cols:30, rows:22, civHint:'8–10 civs' },
  { id:'americas',      name:'Americas',              description:'Maya, Aztec, Inca, North America',        cols:22, rows:32, civHint:'6–8 civs'  },
  { id:'south-asia',    name:'South Asia',            description:'Indus, Ganges, Deccan, SE Asia',          cols:30, rows:22, civHint:'6–8 civs'  },
  { id:'east-asia',     name:'East Asia',             description:'China, Korea, Japan, Indochina',          cols:30, rows:22, civHint:'8–10 civs' },
]

const BUILDERS: Record<string, () => HexMapData> = {
  'mediterranean': buildMediterranean,
  'middle-east':   buildMiddleEast,
  'europe':        buildEurope,
  'americas':      buildAmericas,
  'south-asia':    buildSouthAsia,
  'east-asia':     buildEastAsia,
}

export function generatePreset(id: string): HexMapData | null {
  return BUILDERS[id]?.() ?? null
}
