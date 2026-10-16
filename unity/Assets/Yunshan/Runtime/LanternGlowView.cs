using System.Collections.Generic;
using UnityEngine;
using Yunshan.Core;

namespace Yunshan.Runtime
{
    /// <summary>The city's lanterns as points of warm light after dusk (Core/LanternGlow,
    /// web renderer buildLanternGlow): one mesh of screen-facing quads, sized in the shader.</summary>
    public sealed class LanternGlowView
    {
        readonly MeshRenderer renderer; readonly Material material;
        public int Count { get; }

        public LanternGlowView(Transform parent, WorldDefinition world)
        {
            var glows = LanternGlow.Of(world);
            var vertices = new List<Vector3>(glows.Count * 4); var corners = new List<Vector2>(glows.Count * 4); var sizes = new List<Vector2>(glows.Count * 4); var indices = new List<int>(glows.Count * 6);
            Vector2[] quad = { new Vector2(-1, -1), new Vector2(1, -1), new Vector2(1, 1), new Vector2(-1, 1) };
            foreach (var g in glows)
            {
                // Sizes as the web: street lamps 3.6, eaves and strings 2.8, doors 3.2.
                float size = g.Kind == "street" ? 3.6f : g.Kind == "eave" || g.Kind == "string" ? 2.8f : 3.2f; int start = vertices.Count;
                var centre = Space.ToUnity(g.X, g.Y, g.Z);
                foreach (var corner in quad) { vertices.Add(centre); corners.Add(corner); sizes.Add(new Vector2(size, 0)); }
                indices.AddRange(new[] { start, start + 1, start + 2, start, start + 2, start + 3 });
            }
            var mesh = new Mesh { name = "灯笼远景发光", indexFormat = UnityEngine.Rendering.IndexFormat.UInt32 };
            mesh.SetVertices(vertices); mesh.SetUVs(0, corners); mesh.SetUVs(1, sizes); mesh.SetTriangles(indices, 0);
            // The quads grow in the shader, so the mesh bounds must not cull them.
            mesh.bounds = new Bounds(Vector3.zero, Vector3.one * 20000);
            var go = new GameObject("灯笼远景发光"); go.transform.SetParent(parent, false); go.transform.SetPositionAndRotation(Vector3.zero, Quaternion.identity); go.transform.localScale = Vector3.one;
            go.AddComponent<MeshFilter>().sharedMesh = mesh; renderer = go.AddComponent<MeshRenderer>();
            var shader = Shader.Find("Yunshan/LanternGlow"); material = new Material(shader != null ? shader : Shader.Find("Standard")) { name = "灯笼远景发光" };
            renderer.sharedMaterial = material; renderer.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off; renderer.receiveShadows = false; renderer.enabled = false;
            Count = glows.Count;
        }

        /// <summary>Lights only after dusk: night = max(0, 1 − daylight × 1.6), as on the web.</summary>
        public void Update(double daylight)
        {
            float night = (float)LanternGlow.Night(daylight);
            material.SetFloat("_Night", night); renderer.enabled = night > .01f;
        }
    }
}
