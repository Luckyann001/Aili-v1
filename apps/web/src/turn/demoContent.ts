import fxLever from "../../../../content/robotics/test-fixtures/scene.fx-lever.json";
import fxServoArm from "../../../../content/robotics/test-fixtures/scene.fx-servo-arm.json";
import fxBagHold from "../../../../content/robotics/test-fixtures/scene.fx-bag-hold.json";
import fxServoAsset from "../../../../content/robotics/test-fixtures/asset.fx-servo-generic-anatomy.json";
import fxDrone from "../../../../content/robotics/test-fixtures/scene.fx-drone-altitude.json";
import fxDroneAsset from "../../../../content/robotics/test-fixtures/asset.fx-quadcopter-generic.json";
import type { DemoContent } from "./contentMode";

// The published test-fixture manifests a live turn can put on stage, for the founder demo mode's
// labels (only their review records and asset references are read). Reached only through the
// "aili-demo-content" alias, which points here where the fixture registry is allowed (the dev live
// server and test builds); every other build gets noDemoContent.ts, so no fixture file is in it.
export const DEMO_CONTENT: DemoContent | null = {
  scenes: { [fxLever.id]: fxLever, [fxServoArm.id]: fxServoArm, [fxBagHold.id]: fxBagHold, [fxDrone.id]: fxDrone } as DemoContent["scenes"],
  assets: { [fxServoAsset.id]: fxServoAsset, [fxDroneAsset.id]: fxDroneAsset } as DemoContent["assets"],
};
