using System.Collections.Generic;
using UnityEngine;
using Yunshan.Core;

namespace Yunshan.Runtime
{
    /// <summary>Birds circling above the districts by day (Core/BirdFlocks, as on the web): a two-wing mesh per bird
    /// whose y scale is the flap, so the wings beat. Both faces are in the mesh, so it shows whichever way it is scaled.</summary>
    public sealed class BirdFlockView
    {
        readonly List<Flock> flocks; readonly List<Transform> birds = new List<Transform>(); readonly GameObject root;

        public BirdFlockView(Transform parent, WorldDefinition world)
        {
            flocks = BirdFlocks.Of(world);
            root = new GameObject("城区上空的鸟群"); root.transform.SetParent(parent, false);
            float half = (float)BirdFlocks.Wingspan / 2;
            // Game space is mirrored in X (Space.cs); the wings are symmetric, so only the winding needs both faces.
            var v = new[] { new Vector3(0, 0, .22f), new Vector3(0, 0, -.22f), new Vector3(-half, .35f, -.05f), new Vector3(half, .35f, -.05f) };
            var mesh = new Mesh { name = "鸟" }; mesh.SetVertices(v); mesh.SetTriangles(new[] { 0, 1, 2, 2, 1, 0, 1, 0, 3, 3, 0, 1 }, 0); mesh.RecalculateNormals(); mesh.RecalculateBounds();
            var shader = Shader.Find("Unlit/Color") ?? Shader.Find("Standard"); var material = new Material(shader) { name = "鸟" }; material.color = Space.Hex("#33302c");
            for (int i = 0; i < flocks.Count * BirdFlocks.PerFlock; i++)
            {
                var bird = new GameObject("鸟", typeof(MeshFilter), typeof(MeshRenderer)); bird.transform.SetParent(root.transform, false);
                bird.GetComponent<MeshFilter>().sharedMesh = mesh; var r = bird.GetComponent<MeshRenderer>(); r.sharedMaterial = material; r.shadowCastingMode = UnityEngine.Rendering.ShadowCastingMode.Off; r.receiveShadows = false;
                birds.Add(bird.transform);
            }
            root.SetActive(false);
        }

        public void Update(double seconds, double daylight)
        {
            bool shown = daylight >= BirdFlocks.Daylight; if (root.activeSelf != shown) root.SetActive(shown);
            if (!shown) return;
            var at = BirdFlocks.At(flocks, seconds);
            for (int i = 0; i < birds.Count; i++)
            {
                var b = at[i]; birds[i].SetPositionAndRotation(Space.ToUnity(b.X, b.Y, b.Z), Space.Yaw(b.Yaw));
                birds[i].localScale = new Vector3(1, (float)b.Flap, 1);
            }
        }
    }
}
