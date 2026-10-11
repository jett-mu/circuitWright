# Circuitwright

Build it. Wire it. Watch it run. Circuitwright is a free-form analog circuit sandbox in the browser: real schematic symbols, parts that rotate and flip to any orientation, and a transient simulator that shows voltages, currents and waveforms live. Plain static site (HTML, CSS, ES modules), no build step, no dependencies.

## Running it

ES modules do not load from `file://`, so serve the folder over http:

```
python3 -m http.server 8000
```

Then open http://localhost:8000. For GitHub Pages, deploy the branch root; all paths are relative and fonts are self-hosted.

## Parts

- Sources: DC voltage, battery (internal R), AC / signal source (sine, square, triangle, saw), current source, ground, supply rail, net label.
- Passive: resistor, potentiometer, capacitor, electrolytic, inductor, transformer, fuse (blows on I²t).
- Switches: SPST switch, push button, changeover switch, relay.
- Semiconductors: diode, Schottky, Zener, LED (colours), SCR, NPN, PNP, N/P-MOSFET (body diode), N/P-JFET.
- ICs: op-amp (output clamp), 555 timer.
- Loads and meters: lamp, motor, speaker, voltmeter, ammeter, scope probe.

## Using it

- Drag parts from the palette (or click one to drop it in view). `R` rotates, `F` flips, `Del` removes.
- Drag from a pin to another pin to wire. Drag from the middle of a wire to branch it. Double-click a wire to change its route; `Shift` while drawing makes a straight diagonal.
- Click switches. Select a part to edit values (`4.7k`, `100n`, `2.2u` are understood).
- Probes, voltmeters and ammeters feed the scope. Hover anything for live readings. Wires colour by voltage.
- Undo/redo, autosave to localStorage, save/open JSON, export PNG/SVG schematic with a parts list, or a SPICE netlist.

## Code layout

```
index.html        page shell, toolbar, dialogs
styles.css        LATCH design system (tokens and components)
css/style.css     app layout
js/
  model.js        part catalogue, Circuit, geometry, wire routing, number formatting
  netlist.js      geometry to nets, element list, SPICE writer
  solver.js       MNA transient solver (Newton-Raphson, trapezoidal / backward Euler)
  symbols.js      schematic symbols
  render.js       SVG scene, hop-overs, junctions, live painting
  scope.js        oscilloscope
  main.js         interaction, simulation loop, inspector, dialogs
  examples.js     starter circuits
  export.js       PNG/SVG schematic export
  storage.js      autosave and file save/open
```

Connectivity is geometric: wire vertices, pins and wire ends landing on a wire's run are one net; crossings without a vertex are not connected (drawn with a hop).

## Simulator notes

Modified nodal analysis with a per-step Newton solve. Reactive parts start discharged. Models are educational grade: Ebers-Moll BJT with Early effect, square-law MOSFET/JFET, exponential diodes, ideal-ish op-amp with a clamp. Step size is chosen automatically from the circuit.

## Disclaimer and safety

Circuitwright is an educational tool, provided "as is" without warranty (see `LICENCE.md`). It does not check component ratings, power or thermal limits. Do not use designs for mains voltage, high current, batteries or anything safety critical. Verify everything yourself before building.

&copy; 2026 Jett Mu
