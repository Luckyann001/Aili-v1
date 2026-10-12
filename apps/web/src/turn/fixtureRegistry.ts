import { loadRegistry } from "@aili/engine";
import concepts from "../../../../content/robotics/concepts.json";
import solver from "../../../../content/robotics/capabilities/solver.static-torque-single-link.json";
import sim from "../../../../content/robotics/capabilities/sim.servo-static-load.json";
import srcUp1 from "../../../../content/robotics/capabilities/src.openstax-university-physics-1.json";
import srcCp2 from "../../../../content/robotics/capabilities/src.openstax-college-physics-2e.json";
import arm from "../../../../content/robotics/scenes/base-joint-arm.json";
import lever from "../../../../content/robotics/scenes/lever-analogy.json";
import fxScene from "../../../../content/robotics/test-fixtures/scene.fx-lever.json";
import fxSolver from "../../../../content/robotics/test-fixtures/solver.fx-torque.json";
import fxSim from "../../../../content/robotics/test-fixtures/sim.fx-servo-load.json";
import fxSource from "../../../../content/robotics/test-fixtures/src.fx-book.json";
import fxReading from "../../../../content/robotics/test-fixtures/read.fx-moments.json";
import fxDraft from "../../../../content/robotics/test-fixtures/read.fx-draft.json";

// The dev-only registry for the fake director: real content (all draft) plus the test fixtures.
// Loaded only through `loadFixtureRegistry` in server.ts, which exists only when the flag is set,
// so a production build never includes these files.
export function fixtureTurnRegistry() {
  return loadRegistry(
    {
      concepts,
      scenes: [
        { file: "base-joint-arm.json", data: arm },
        { file: "lever-analogy.json", data: lever },
        { file: "test-fixtures/scene.fx-lever.json", data: fxScene },
      ],
      capabilities: [solver, sim, srcUp1, srcCp2, fxSolver, fxSim, fxSource, fxReading, fxDraft].map((data) => ({ file: `${(data as { id: string }).id}.json`, data })),
    },
    { allowTestFixtures: true },
  );
}
