// All value imports use the pure barrel. Register the extensions this renderer uses.
import {
  Engine, Constants, Scene, Camera, TargetCamera, TransformNode, Mesh, RawTexture, Texture,
  ShaderMaterial, CreatePlane, VertexBuffer, Vector2, Vector3, Vector4,
  Quaternion, Matrix, Color4, PostProcess, Effect, EffectRenderer, EffectWrapper, RenderTargetTexture, RenderingManager,
  RegisterCoreEngineExtensions, RegisterAbstractEngineTexture, RegisterEnginesExtensionsEngineAlpha,
  RegisterEnginesExtensionsEngineRenderTarget, RegisterEnginesExtensionsEngineRenderTargetTexture, RegisterEngineUniformBuffer,
  RegisterEnginesExtensionsEngineRawTexture, RegisterEngineDynamicBuffer,
  RegisterThinInstanceMesh, RegisterRenderTargetTexture,
} from "@babylonjs/core/pure";
import type {} from "@babylonjs/core/Meshes/thinInstanceMesh";

export function registerBabylon():void {
  RegisterCoreEngineExtensions();
  RegisterAbstractEngineTexture();
  RegisterEnginesExtensionsEngineAlpha();
  RegisterEnginesExtensionsEngineRenderTarget();
  RegisterEnginesExtensionsEngineRenderTargetTexture();
  RegisterEngineUniformBuffer();
  RegisterEnginesExtensionsEngineRawTexture();
  RegisterEngineDynamicBuffer();
  RegisterThinInstanceMesh();
  RegisterRenderTargetTexture();
}

// A deliberately bounded set of constructors, shared by backend components.
export const B = {
  Engine, Constants, Scene, Camera, TargetCamera, TransformNode, Mesh, RawTexture, Texture,
  ShaderMaterial, CreatePlane, VertexBuffer, Vector2, Vector3, Vector4,
  Quaternion, Matrix, Color4, PostProcess, Effect, EffectRenderer, EffectWrapper, RenderTargetTexture, RenderingManager,
};
