import {Frame,Time,AnimationTrackFloat32,AnimationTrackInt32,AnimationTrackBoolean,packInterpolationModes,type FrameNumber,type FrameStamp,type DeepPartial,type PackedInterpolationModes,type AnimationClock} from "../../src/runtime/index.js";

const first:FrameNumber=Frame.from(10);
const next:FrameNumber=Frame.add(first,Frame.from(2));
Time.fromFrame(next);
Frame.from(first);
Frame.from(-3);
const dynamic:number=Number("12");
Frame.from(dynamic); // Dynamic values are checked at runtime.
// @ts-expect-error A known fractional literal cannot construct a FrameNumber.
Frame.from(1.5);
const fractional=2236.25 as const;
// @ts-expect-error Const fractional values cannot construct a FrameNumber either.
Frame.from(fractional);
declare const mixed:1|1.5;
// @ts-expect-error Every member of a literal union must be an integer.
Frame.from(mixed);
const stamp:DeepPartial<FrameStamp>={frame:first};
// @ts-expect-error Partial component patches must retain the frame brand.
const invalidStamp:DeepPartial<FrameStamp>={frame:1.5};
// @ts-expect-error A branded numeric field must not become a partial object.
const invalidObjectStamp:DeepPartial<FrameStamp>={frame:{}};
void [stamp,invalidStamp,invalidObjectStamp];
// @ts-expect-error Raw numbers are not frame indices.
const invalid:FrameNumber=10;
// @ts-expect-error Frame arithmetic must go through the checked operators.
const sum:FrameNumber=first+next;
// @ts-expect-error The second operand also needs a FrameNumber.
Frame.add(first,2);
// @ts-expect-error Fractional seconds cannot enter a FrameTime as a raw number.
Time.fromFrame(1.5);

declare const clock:AnimationClock;
clock.pauseOffsetHint=Time.fromRatio(2236n,30n);
// @ts-expect-error Pause hints retain rational time rather than untyped seconds.
clock.pauseOffsetHint=2236/30;
clock.pauseOffsetHint=undefined;

const float=new AnimationTrackFloat32({frameNumber:[0],value:[1]});
const int=new AnimationTrackInt32({frameNumber:[0],value:[1]});
const bool=new AnimationTrackBoolean({frameNumber:[0],value:[1]});
const floats:Float32Array=float.value,integers:Int32Array=int.value,booleans:Uint8Array=bool.value;
const keys:Int32Array=float.frameNumber,headers:Int32Array=float.interpolation,curve:Float32Array=float.interpolationParameters;
const modes:PackedInterpolationModes=packInterpolationModes(0,2);
// @ts-expect-error Tag 3 is reserved.
packInterpolationModes(3,1);
// @ts-expect-error Raw numbers must be packed/validated before becoming mode bitfields.
const invalidModes:PackedInterpolationModes=8;
const flag:boolean|undefined=bool.evaluate(Time.fromFrame(first));
// @ts-expect-error Storage is specific to the track type.
const wrongStorage:Int32Array=float.value;
// @ts-expect-error Tracks deliberately have no object binding.
float.binding={entity:"actor"};
void [invalid,sum,floats,integers,booleans,keys,headers,curve,modes,invalidModes,flag,wrongStorage];
