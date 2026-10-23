using UnityEngine;
using Yunshan.Core;

namespace Yunshan.Runtime
{
    /// <summary>Display-only rain (web renderer rain streaks, Core/Rain.cs): a line mesh of short
    /// streaks around the camera while the simulation's weather is rain and the player is outdoors.</summary>
    public sealed class RainView
    {
        readonly GameObject root; readonly Mesh mesh; readonly Material material;
        readonly Vector3[] vertices = new Vector3[Rain.Count * 2];

        public RainView(Transform parent)
        {
            root = new GameObject("雨丝"); root.transform.SetParent(parent, false);
            mesh = new Mesh { name = "雨丝" }; mesh.MarkDynamic();
            var colors = new Color[vertices.Length]; var indices = new int[vertices.Length];
            for (int k = 0; k < vertices.Length; k++) { colors[k] = Color.white; indices[k] = k; }
            mesh.vertices = vertices; mesh.colors = colors; mesh.SetIndices(indices, MeshTopology.Lines, 0);
            mesh.bounds = new Bounds(Vector3.zero, Vector3.one * 1e6f);
            var shader = Shader.Find("Yunshan/UnlitColor"); if (shader == null) shader = Shader.Find("Sprites/Default");
            material = new Material(shader) { name = "雨丝" }; material.color = new Color(.56f, .64f, .68f, .5f);
            root.AddComponent<MeshFilter>().sharedMesh = mesh; root.AddComponent<MeshRenderer>().sharedMaterial = material;
            root.SetActive(false);
        }

        public void Update(string weather, bool inside, Vector3 cameraUnity, float daylight)
        {
            bool active = Rain.Active(weather, inside); if (root.activeSelf != active) root.SetActive(active);
            if (!active) return;
            var camera = Space.ToGame(cameraUnity); double t = Time.time;
            for (int i = 0; i < Rain.Count; i++)
            {
                var top = Rain.Drop(i, t, camera);
                vertices[i * 2] = Space.ToUnity(top);
                vertices[i * 2 + 1] = Space.ToUnity(top.X - Rain.SlantX * Rain.Length, top.Y - Rain.Length, top.Z - Rain.SlantZ * Rain.Length);
            }
            mesh.vertices = vertices; material.color = new Color(.56f, .64f, .68f, .3f + daylight * .3f);
        }
    }
}
