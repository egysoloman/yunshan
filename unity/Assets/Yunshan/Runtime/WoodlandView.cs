using System.Collections.Generic;
using System.Linq;
using UnityEngine;
using Yunshan.Core;

namespace Yunshan.Runtime
{
    /// <summary>The shared woodland layout (Core/WoodlandLayout.cs, parity with
    /// src/rendering/woodland-layout.ts). Near trees and shrubs are pooled
    /// clones of the studio models at their original size; every other tree is
    /// a trunk and two crown boxes at the same model height, as the web
    /// renderer's far woodland. Display only.</summary>
    public sealed class WoodlandView
    {
        // Same radii and counts as WOODLAND_MODEL_RANGE (balanced quality) on the web.
        public float TreeRange = 160, ShrubRange = 70; public int TreeCount = 120, ShrubCount = 120;
        // Ground dressing (understorey, bank plants, mountain-foot rocks): near models only, no block form.
        public float GroundRange = 70, RockRange = 280; public int GroundCount = 120, RockCount = 50;
        readonly List<WoodlandLayout.GroundItem> ground;
        readonly WoodlandLayout.Result layout;
        readonly StudioAssets studio;
        readonly Transform root;
        readonly InstancedBoxes trunks, crowns;
        readonly Dictionary<string, List<GameObject>> pool = new Dictionary<string, List<GameObject>>();
        readonly HashSet<int> modelledTrees = new HashSet<int>();
        Vector2Int lastCell = new Vector2Int(int.MinValue, 0);
        static readonly string[] SpeciesColors = { "#ad6b3a", "#a79541", "#6b854c", "#365d40", "#365d40", "#365d40", "#365d40", "#365d40", "#365d40" };

        public int ModelledTrees => modelledTrees.Count;
        public int Trees => layout.Trees.Count;

        public WoodlandView(WoodlandLayout.Result layout, StudioAssets studio, Transform parent, List<WoodlandLayout.GroundItem> ground = null)
        {
            this.layout = layout; this.studio = studio; this.ground = ground ?? new List<WoodlandLayout.GroundItem>();
            root = new GameObject("山林 · 原尺寸体素工坊林木").transform; root.SetParent(parent, false);
            var shader = Shader.Find("Yunshan/InstancedColor");
            trunks = new InstancedBoxes(new Material(shader) { name = "云山 · 林木树干代理" });
            crowns = new InstancedBoxes(new Material(shader) { name = "云山 · 林木树冠代理" });
        }

        public void Update(Vector3 cameraUnity)
        {
            var camera = Space.ToGame(cameraUnity);
            var cell = new Vector2Int(Mathf.RoundToInt((float)camera.X / 8), Mathf.RoundToInt((float)camera.Z / 8));
            if (cell != lastCell) { lastCell = cell; Reselect(camera); }
            trunks.Draw(); crowns.Draw();
        }

        void Reselect(Vec3 camera)
        {
            double Distance(double x, double z) => JsMath.Hypot(x - camera.X, z - camera.Z);
            var nearTrees = layout.Trees.Where(t => studio.Has(t.Asset)).Select(t => (t, d: Distance(t.X, t.Z))).Where(e => e.d <= TreeRange)
                .OrderBy(e => e.d).ThenBy(e => e.t.Id).Take(TreeCount).Select(e => e.t).ToList();
            var nearShrubs = layout.Shrubs.Where(s => studio.Has(s.Asset)).Select(s => (s, d: Distance(s.X, s.Z))).Where(e => e.d <= ShrubRange)
                .OrderBy(e => e.d).ThenBy(e => e.s.Id).Take(ShrubCount).Select(e => e.s).ToList();
            List<WoodlandLayout.GroundItem> NearGround(string tier, float range, int count) => ground.Where(g => g.Tier == tier && studio.Has(g.Asset)).Select(g => (g, d: Distance(g.X, g.Z))).Where(e => e.d <= range)
                .OrderBy(e => e.d).ThenBy(e => e.g.Id).Take(count).Select(e => e.g).ToList();
            var nearGround = NearGround("ground", GroundRange, GroundCount).Concat(NearGround("rock", RockRange, RockCount)).ToList();
            var used = new Dictionary<string, int>();
            GameObject Take(string asset)
            {
                if (!pool.TryGetValue(asset, out var list)) pool[asset] = list = new List<GameObject>();
                used.TryGetValue(asset, out int n); used[asset] = n + 1;
                if (n < list.Count) { list[n].SetActive(true); return list[n]; }
                var copy = studio.Place(asset, root, new Vec3(0, 0, 0), 0, 1); list.Add(copy); return copy;
            }
            foreach (var t in nearTrees) { var go = Take(t.Asset); go.transform.SetPositionAndRotation(Space.ToUnity(t.X, t.Y, t.Z), Space.Yaw(t.Yaw)); }
            foreach (var s in nearShrubs) { var go = Take(s.Asset); go.transform.SetPositionAndRotation(Space.ToUnity(s.X, s.Y, s.Z), Space.Yaw(s.Yaw)); }
            foreach (var g in nearGround) { var go = Take(g.Asset); go.transform.SetPositionAndRotation(Space.ToUnity(g.X, g.Y, g.Z), Space.Yaw(g.Yaw)); }
            foreach (var pair in pool) { used.TryGetValue(pair.Key, out int n); for (int i = n; i < pair.Value.Count; i++) pair.Value[i].SetActive(false); }
            modelledTrees.Clear(); foreach (var t in nearTrees) modelledTrees.Add(t.Id);
            // Every other tree: the web far proxy (trunk + two stepped crowns) at its model's height.
            trunks.Clear(); crowns.Clear();
            var trunkColor = Space.Hex("#6b5c45");
            foreach (var t in layout.Trees)
            {
                if (modelledTrees.Contains(t.Id)) continue;
                double h = t.Height; var color = Space.Hex(SpeciesColors[t.Species]);
                trunks.Add(Space.ToUnity(t.X, t.Y + h * .35, t.Z), Quaternion.identity, new Vector3(.8f, (float)(h * .7), .8f), trunkColor);
                for (int tier = 0; tier < 2; tier++)
                {
                    double ty = t.Y + h * .35 + h * .7 * (.42 + tier * .35);
                    var size = new Vector3((float)(h * .7 * (tier == 1 ? .9 : 1.25)), (float)(h * .7 * .55), (float)(h * .7 * (tier == 1 ? .75 : 1.08)));
                    crowns.Add(Space.ToUnity(t.X + (tier == 1 ? 1 : -1) * h * .7 * .15, ty, t.Z + tier * h * .7 * .1), Quaternion.identity, size, color * (tier == 1 ? 1.08f : .92f));
                }
            }
        }
    }
}
