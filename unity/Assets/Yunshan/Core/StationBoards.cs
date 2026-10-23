// Port of src/rendering/station-wayfinding.ts (stationWallBoards and
// describeStationBoard). The board reads connected edges, closures, the
// crossing signal and nearby vehicles from the host frame; it promises no
// timetable merely because a canopy exists.
using System.Collections.Generic;
using System.Linq;
using Yunshan.Core.Host;

namespace Yunshan.Core
{
    public static class StationBoards
    {
        public sealed class WallBoard { public Vec3 Position; public double Rotation, Width, Height; }
        public sealed class View
        {
            public string Name, District, Signal; public List<string> Connections = new List<string>();
            public int Closed, Total, NearbyVehicles;
            public string Signature => $"{Name}|{District}|{string.Join("/", Connections)}|{Signal}|{Closed}|{Total}|{NearbyVehicles}";
        }

        static readonly Dictionary<string, string> Modes = new Dictionary<string, string>
        {
            ["road"] = "道路", ["bridge"] = "桥路", ["maglev"] = "磁悬浮", ["lightRail"] = "轻轨",
            ["cable"] = "缆车", ["lift"] = "升降", ["ferry"] = "渡船", ["flight"] = "航线",
        };

        /// <summary>Four boards painted on the faces of the two canopy posts.</summary>
        public static List<WallBoard> WallBoards(NetworkNode node)
        {
            var boards = new List<WallBoard>();
            if (!node.Station) return boards;
            foreach (var offset in new[] { -8.0, 8.0 })
                foreach (var side in new[] { -1, 1 })
                    boards.Add(new WallBoard { Position = new Vec3(node.Position.X + offset, node.Position.Y + 3.05, node.Position.Z + side * .403), Rotation = side == 1 ? 0 : System.Math.PI, Width = .66, Height = 3.6 });
            return boards;
        }

        public static View Describe(WorldDefinition world, SimFrame frame, NetworkNode node)
        {
            var edges = world.Edges.Where(e => e.From == node.Id || e.To == node.Id).ToList();
            var closed = new HashSet<string>(frame.ClosedEdges);
            var open = edges.Where(e => !closed.Contains(e.Id)).ToList();
            var view = new View { Name = node.Name, Total = edges.Count, Closed = edges.Count - open.Count };
            foreach (var e in open) { var name = Modes.TryGetValue(e.Mode, out var m) ? m : e.Mode; if (!view.Connections.Contains(name)) view.Connections.Add(name); }
            var ids = new HashSet<string>(edges.Select(e => e.Id));
            view.NearbyVehicles = frame.Vehicles.Count(v => ids.Contains(v.EdgeId)
                && JsMath.Hypot(v.Position.X - node.Position.X, v.Position.Y - node.Position.Y, v.Position.Z - node.Position.Z) <= 16);
            bool known = frame.Signals.TryGetValue(node.Id, out var phase);
            view.Signal = !known ? "信号未登记" : phase == 1 ? "路口通行" : phase == 0 ? "路口等候" : "信号未登记";
            view.District = world.Districts.FirstOrDefault(d => d.Id == node.DistrictId)?.Name ?? node.DistrictId;
            return view;
        }

        /// <summary>Vertical print as on the web canvas: 驿, the station name
        /// one character per line, then district, connections, links, signal
        /// and nearby vehicles.</summary>
        public static List<string> Lines(View view)
        {
            var lines = new List<string> { "驿", "" };
            lines.AddRange(view.Name.Select(c => c.ToString()));
            lines.Add("");
            lines.Add(view.District);
            lines.Add(view.Connections.Count > 0 ? string.Join(" / ", view.Connections) : "暂无开放连接");
            lines.Add($"连接 {view.Total - view.Closed}/{view.Total}");
            lines.Add(view.Signal);
            lines.Add($"近站载具 {view.NearbyVehicles}");
            return lines;
        }
    }
}
