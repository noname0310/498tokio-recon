// All value imports use the pure barrel. Register the extensions this renderer uses.
import {
  Engine, Scene, Camera, FreeCamera, TransformNode, RawTexture, Texture,
  ShaderMaterial, CreatePlane, VertexBuffer, Vector2, Vector3, Vector4,
  Quaternion, Matrix, Color4, PostProcess, Effect, EffectRenderer, EffectWrapper, RenderTargetTexture, RenderingManager,
  RegisterStandardEngineExtensions, RegisterEnginesExtensionsEngineRawTexture,
  RegisterEnginesExtensionsEngineReadTexture, RegisterEngineDynamicBuffer,
  RegisterThinInstanceMesh, RegisterCollisionCoordinator, RegisterRenderTargetTexture,
} from "@babylonjs/core/pure";
import type {} from "@babylonjs/core/Meshes/thinInstanceMesh";

export function registerBabylon():void {
  RegisterStandardEngineExtensions();
  RegisterEnginesExtensionsEngineRawTexture();
  RegisterEnginesExtensionsEngineReadTexture();
  RegisterEngineDynamicBuffer();
  RegisterThinInstanceMesh();
  RegisterCollisionCoordinator();
  RegisterRenderTargetTexture();
}

// A deliberately bounded set of constructors, shared by backend components.
export const B = {
  Engine, Scene, Camera, FreeCamera, TransformNode, RawTexture, Texture,
  ShaderMaterial, CreatePlane, VertexBuffer, Vector2, Vector3, Vector4,
  Quaternion, Matrix, Color4, PostProcess, Effect, EffectRenderer, EffectWrapper, RenderTargetTexture, RenderingManager,
};
