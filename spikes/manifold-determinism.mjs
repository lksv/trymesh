// Doplněk spiku: je výstup booleanu bitově stejný při opakování?
import Module from 'manifold-3d';
const wasm = await Module(); wasm.setup();
const { Manifold } = wasm;
const run = () => {
  const m = Manifold.cube([40, 30, 10]).rotate([30, 20, 10]).subtract(Manifold.cylinder(12, 5, 5, 32).translate([20, 15, -1]).rotate([30, 20, 10])).getMesh();
  return JSON.stringify([[...m.vertProperties], [...m.triVerts], [...m.faceID]]);
};
const a = run(), b = run();
console.log('opakovaný boolean dá bitově stejný výstup:', a === b);
