using System.Collections.Generic;
using System.Linq;
using UnityEngine;
using Yunshan.Core;
using Yunshan.Core.Host;

namespace Yunshan.Runtime
{
    /// <summary>Printed boards on the canopy posts of at most eight stations
    /// within 100 m (port of StationWayfindingPool). Each print reads the live
    /// frame: open connections, closures, the crossing signal and vehicles on
    /// the station's own edges. Boards are lit by the scene, not self-lit.</summary>
    public sealed class StationSignPool
    {
        sealed class Entry { public GameObject Root; public List<TextMesh> Texts = new List<TextMesh>(); public string Signature = ""; }
        readonly Transform parent; readonly WorldDefinition world; readonly Font font; readonly Material plate;
        readonly List<NetworkNode> stations;
        readonly Dictionary<string, Entry> entries = new Dictionary<string, Entry>();
        public int Paints { get; private set; }

        public StationSignPool(Transform parent, WorldDefinition world, Font font)
        {
            this.parent = parent; this.world = world; this.font = font;
            stations = world.Nodes.Where(n => n.Station).ToList();
            var shader = Shader.Find("Yunshan/InstancedColor"); if (shader == null) shader = Shader.Find("Standard");
            plate = new Material(shader) { name = "驿站柱面站牌" }; plate.SetColor("_Color", Space.Hex("#ded3b6"));
        }

        public void Update(SimFrame frame, Vector3 cameraUnity, int limit = 8)
        {
            if (frame == null) return;
            var camera = Space.ToGame(cameraUnity);
            double Distance(NetworkNode n) => JsMath.Hypot(camera.X - n.Position.X, camera.Y - n.Position.Y, camera.Z - n.Position.Z);
            var selected = stations.Where(n => Distance(n) <= 100).OrderBy(Distance).ThenBy(n => n.Id, System.StringComparer.Ordinal)
                .Take(Mathf.Clamp(limit, 0, 8)).ToList();
            var desired = new HashSet<string>(selected.Select(n => n.Id));
            foreach (var id in entries.Keys.ToList()) if (!desired.Contains(id)) { Object.Destroy(entries[id].Root); entries.Remove(id); }
            foreach (var node in selected)
            {
                if (!entries.TryGetValue(node.Id, out var entry)) entries[node.Id] = entry = Create(node);
                var view = StationBoards.Describe(world, frame, node);
                if (entry.Signature == view.Signature) continue;
                // The link count turns rust red while any connected edge is closed.
                var lines = StationBoards.Lines(view);
                string links = $"连接 {view.Total - view.Closed}/{view.Total}";
                var text = string.Join("\n", lines.Select(l => l == links ? $"<color={(view.Closed > 0 ? "#95543a" : "#37564c")}>{l}</color>" : l));
                foreach (var t in entry.Texts) { t.text = text; Fit(t); }
                entry.Signature = view.Signature; Paints++;
            }
        }

        Entry Create(NetworkNode node)
        {
            var entry = new Entry { Root = new GameObject("柱面站牌 · " + node.Name) };
            entry.Root.transform.SetParent(parent, false);
            foreach (var board in StationBoards.WallBoards(node))
            {
                // Game +Z normal stays +Z in Unity (only X is mirrored). A quad
                // faces −Z, so a board facing +Z is turned half round.
                bool facesPositiveZ = board.Rotation == 0;
                var rotation = Quaternion.Euler(0, facesPositiveZ ? 180 : 0, 0);
                var normal = facesPositiveZ ? Vector3.forward : Vector3.back;
                var quad = GameObject.CreatePrimitive(PrimitiveType.Quad); quad.name = "站牌底板";
                Object.Destroy(quad.GetComponent<Collider>());
                quad.transform.SetParent(entry.Root.transform, false);
                quad.transform.SetPositionAndRotation(Space.ToUnity(board.Position), rotation);
                quad.transform.localScale = new Vector3((float)board.Width, (float)board.Height, 1);
                quad.GetComponent<MeshRenderer>().sharedMaterial = plate;
                var label = new GameObject("站牌文字", typeof(TextMesh)); label.transform.SetParent(entry.Root.transform, false);
                label.transform.SetPositionAndRotation(Space.ToUnity(board.Position) + normal * .01f, rotation);
                var t = label.GetComponent<TextMesh>(); t.anchor = TextAnchor.MiddleCenter; t.alignment = TextAlignment.Center; t.fontSize = 48; t.characterSize = .05f; t.richText = true; t.color = Space.Hex("#3c352c");
                if (font != null) { t.font = font; label.GetComponent<MeshRenderer>().sharedMaterial = font.material; }
                entry.Texts.Add(t);
            }
            return entry;
        }

        /// <summary>Scales the print to the 0.6 × 3.4 m printable area of the .66 × 3.6 m board.</summary>
        static void Fit(TextMesh t)
        {
            t.transform.localScale = Vector3.one;
            var size = t.GetComponent<MeshRenderer>().bounds.size;
            float width = Mathf.Max(size.x, 1e-3f), height = Mathf.Max(size.y, 1e-3f);
            float s = Mathf.Min(.6f / width, 3.4f / height);
            t.transform.localScale = new Vector3(s, s, s);
        }

        public void Dispose() { foreach (var e in entries.Values) Object.Destroy(e.Root); entries.Clear(); Object.Destroy(plate); }
    }
}
