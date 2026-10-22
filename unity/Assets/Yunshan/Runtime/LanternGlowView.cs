using System.Collections.Generic;
using UnityEngine;
using Yunshan.Core;

namespace Yunshan.Runtime
{
    /// <summary>The city's lanterns as points of warm light after dusk (Core/LanternGlow,
    /// web renderer buildLanternGlow): one mesh of screen-facing quads, sized in the shader.</summary>
    public sealed class LanternGlowView
    {
        readonly MeshRenderer renderer, pools; readonly Material material, poolMaterial;
        public int Count { get; }

        public LanternGlowView(Transform parent, WorldDefinition world)
        {
            var glows = LanternGlow.Of(world);
            var vertices = new List<Vector3>(glows.Count * 4); var corners = new List<Vector2>(glows.Count * 4); var sizes = new List<Vector2>(glows.Count * 4); var indices = new List<int>(glows.Count * 6);
            Vector2[] quad = { new Vector2(-1, -1), new Vector2(1, -1), new Vector2(1, 1), new Vector2(-1, 1) };
            foreach (var g in glows)
            {
                // Sizes as the web: street lamps 3.6, eaves and strings 2.8, doors 3.2; y marks the modelled string lanterns.
                float size = g.Kind == "street" ? 3.6f : g.Kind == "eave" || g.Kind == "string" ? 2.8f : 3.2f; int start = vertices.Count;
                var centre = Space.ToUnity(g.X, g.Y, g.Z);
                foreach (var corner in quad) { vertices.Add(centre); corners.Add(corner); sizes.Add(new Vector2(size, g.Kind == "string" ? 1 : 0)); }
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
            // Warm pools on the ground under street and door lamps (Core/GroundGlow, web buildGroundGlow).
            var pv = new List<Vector3>(); var pc = new List<Vector2>(); var pi = new List<int>();
            foreach (var p in GroundGlow.Pools(world))
            {
                double ux = p.Along?[0] ?? 1, uy = p.Along?[1] ?? 0, uz = p.Along?[2] ?? 0, h = System.Math.Sqrt(ux * ux + uz * uz); if (h == 0) h = 1;
                double sx = -uz / h, sz = ux / h; int start = pv.Count;
                foreach (var (cu, cs) in new[] { (-1.0, -1.0), (1.0, -1.0), (1.0, 1.0), (-1.0, 1.0) })
                { pv.Add(Space.ToUnity(p.X + (ux * cu + sx * cs) * p.Radius, p.Y + uy * cu * p.Radius, p.Z + (uz * cu + sz * cs) * p.Radius)); pc.Add(new Vector2((float)cu, (float)cs)); }
                pi.AddRange(new[] { start, start + 2, start + 1, start, start + 3, start + 2 });
            }
            var poolMesh = new Mesh { name = "灯下地面暖光", indexFormat = UnityEngine.Rendering.IndexFormat.UInt32 };
            poolMesh.SetVertices(pv); poolMesh.SetUVs(0, pc); poolMesh.SetTriangles(pi, 0); poolMesh.RecalculateBounds();
            var pgo = new GameObject("灯下地面暖光"); pgo.transform.SetParent(parent, false); pgo.transform.SetPositionAndRotation(Vector3.zero, Quaternion.identity);
            pgo.AddComponent<MeshFilter>().sharedMesh = poolMesh; pools = pgo.AddComponent<MeshRenderer>();
            var poolShader = Shader.Find("Yunshan/GroundGlow"); poolMaterial = new Material(poolShader != null ? poolShader : Shader.Find("Standard")) { name = "灯下地面暖光" };
            pools.sharedMaterial = poolMaterial; pools.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off; pools.receiveShadows = false; pools.enabled = false;
        }

        /// <summary>Lights only after dusk: night = max(0, 1 − daylight × 1.6), as on the web.</summary>
        public void Update(double daylight)
        {
            float night = (float)LanternGlow.Night(daylight);
            material.SetFloat("_Night", night); renderer.enabled = night > .01f;
            poolMaterial.SetFloat("_Night", night); pools.enabled = night > .01f;
        }
    }
}
