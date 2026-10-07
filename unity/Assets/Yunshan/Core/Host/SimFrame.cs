using System.Collections.Generic;

namespace Yunshan.Core.Host
{
    /// <summary>Typed view of one host frame (src/native-host/sim-host.ts HostFrame).</summary>
    public sealed class SimFrame
    {
        public sealed class PlayerInfo
        {
            public Vec3 Position; public string Role; public List<string> Identities = new List<string>();
            public double Money, Reputation, Education; public double Hunger, Fatigue, Social, Fun;
            public Dictionary<string, double> Inventory = new Dictionary<string, double>();
            public string HomeId, VehicleId; public bool Driving, Alive;
        }
        public sealed class Citizen
        {
            public string Id, Name, Role, State; public Vec3 Position, Next; public double Age, Mood, Stress; public bool Alive, Seated;
        }
        public sealed class Vehicle
        {
            public string Id, Kind, EdgeId, State; public Vec3 Position; public double Progress, Direction;
        }
        public sealed class Aircraft { public string Id, Kind, Status; public Vec3 Position; public double Yaw, Pitch; public bool Active; }
        public sealed class Event { public double Id, Tick; public string Type, Text; }

        public double Tick, Day, Hour, Speed, Visibility, Energy, Treasury, Support, StepMs, Ticks, LastEventId;
        public bool Paused; public string Weather;
        public PlayerInfo Player = new PlayerInfo();
        public List<Citizen> Citizens = new List<Citizen>();
        public List<Vehicle> Vehicles = new List<Vehicle>();
        public List<Aircraft> AircraftList = new List<Aircraft>();
        public Dictionary<string, int> Signals = new Dictionary<string, int>();
        public List<Event> Events = new List<Event>();
        public string NavigationDestination, NavigationUnavailable; public List<Vec3> NavigationPoints = new List<Vec3>();
        /// <summary>Null when unchanged since the voxelKey the client sent.</summary>
        public List<Vec3> Voxels; public string VoxelKey;
        /// <summary>Food units shown on open markets' counters, by building id.</summary>
        public Dictionary<string, int> MarketUnits = new Dictionary<string, int>();
        /// <summary>Closed network edges (barriers at both ends).</summary>
        public List<string> ClosedEdges = new List<string>();
        /// <summary>Refusal of the requested walking position (closed road), else null.</summary>
        public string Rejected;

        public static SimFrame From(object o)
        {
            var f = new SimFrame
            {
                Tick = Json.Num(o, "tick"), Day = Json.Num(o, "day"), Hour = Json.Num(o, "hour"), Speed = Json.Num(o, "speed", 1), Visibility = Json.Num(o, "visibility", 1),
                Energy = Json.Num(o, "energy"), Treasury = Json.Num(o, "treasury"), Support = Json.Num(o, "support"), StepMs = Json.Num(o, "stepMs"), Ticks = Json.Num(o, "ticks"),
                LastEventId = Json.Num(o, "lastEventId"), Paused = Json.Bool(o, "paused"), Weather = Json.Str(o, "weather", ""),
            };
            var p = Json.Obj(o, "player");
            if (p != null)
            {
                var needs = Json.Obj(p, "needs");
                f.Player = new PlayerInfo
                {
                    Position = Json.Vec(p.TryGetValue("position", out var pos) ? pos : null), Role = Json.Str(p, "role", "traveler"),
                    Money = Json.Num(p, "money"), Reputation = Json.Num(p, "reputation"), Education = Json.Num(p, "education"),
                    Hunger = Json.Num(needs, "hunger"), Fatigue = Json.Num(needs, "fatigue"), Social = Json.Num(needs, "social"), Fun = Json.Num(needs, "fun"),
                    HomeId = Json.Str(p, "homeId"), VehicleId = Json.Str(p, "vehicleId"), Driving = Json.Bool(p, "driving"), Alive = Json.Bool(p, "alive", true),
                };
                foreach (var id in Json.Arr(p, "identities") ?? new List<object>()) if (id is string s) f.Player.Identities.Add(s);
                var inventory = Json.Obj(p, "inventory");
                if (inventory != null) foreach (var pair in inventory) if (pair.Value is double d) f.Player.Inventory[pair.Key] = d;
            }
            foreach (var c in Json.Arr(o, "citizens") ?? new List<object>())
            {
                var d = (Dictionary<string, object>)c;
                f.Citizens.Add(new Citizen
                {
                    Id = Json.Str(d, "id"), Name = Json.Str(d, "name"), Role = Json.Str(d, "role"), State = Json.Str(d, "state"),
                    Position = Json.Vec(d["position"]), Next = d.TryGetValue("next", out var next) ? Json.Vec(next) : null,
                    Age = Json.Num(d, "age", 30), Mood = Json.Num(d, "mood", 60), Stress = Json.Num(d, "stress", 20), Alive = Json.Bool(d, "alive", true), Seated = Json.Bool(d, "seated"),
                });
            }
            foreach (var v in Json.Arr(o, "vehicles") ?? new List<object>())
            {
                var a = (List<object>)v;
                f.Vehicles.Add(new Vehicle { Id = (string)a[0], Kind = (string)a[1], Position = new Vec3((double)a[2], (double)a[3], (double)a[4]), EdgeId = (string)a[5], Progress = (double)a[6], Direction = (double)a[7], State = a[8] as string });
            }
            foreach (var a in Json.Arr(o, "aircraft") ?? new List<object>())
            {
                var d = (Dictionary<string, object>)a;
                f.AircraftList.Add(new Aircraft { Id = Json.Str(d, "id"), Kind = Json.Str(d, "kind"), Status = Json.Str(d, "status"), Position = Json.Vec(d["position"]), Yaw = Json.Num(d, "yaw"), Pitch = Json.Num(d, "pitch"), Active = Json.Bool(d, "active") });
            }
            var signals = Json.Obj(o, "signals");
            if (signals != null) foreach (var pair in signals) if (pair.Value is double phase) f.Signals[pair.Key] = (int)phase;
            foreach (var e in Json.Arr(o, "events") ?? new List<object>())
                f.Events.Add(new Event { Id = Json.Num(e, "id"), Tick = Json.Num(e, "tick"), Type = Json.Str(e, "type"), Text = Json.Str(e, "text") });
            var nav = Json.Obj(o, "navigation");
            if (nav != null)
            {
                f.NavigationDestination = Json.Str(nav, "destination"); f.NavigationUnavailable = Json.Str(nav, "unavailable");
                foreach (var point in Json.Arr(nav, "points") ?? new List<object>()) f.NavigationPoints.Add(Json.Vec(point));
            }
            var voxels = Json.Arr(o, "voxels");
            if (voxels != null) { f.Voxels = new List<Vec3>(); foreach (var v in voxels) { var a = (List<object>)v; f.Voxels.Add(new Vec3((double)a[0], (double)a[1], (double)a[2])); } }
            f.VoxelKey = Json.Str(o, "voxelKey"); f.Rejected = Json.Str(o, "rejected");
            foreach (var id in Json.Arr(o, "closedEdges") ?? new List<object>()) if (id is string edgeId) f.ClosedEdges.Add(edgeId);
            var markets = Json.Obj(o, "marketUnits");
            if (markets != null) foreach (var pair in markets) if (pair.Value is double units) f.MarketUnits[pair.Key] = (int)units;
            return f;
        }
    }

    /// <summary>One context-panel action (src/native-host/context-model.ts).</summary>
    public sealed class ContextAction
    {
        public string Label; public bool Disabled; public string Client; public Dictionary<string, object> Command;
    }
    public sealed class ContextSection
    {
        public string Kind, Id, Eyebrow, Title, Subtitle; public List<ContextAction> Actions = new List<ContextAction>(); public List<string> Notes = new List<string>();
        public static List<ContextSection> ListFrom(object o)
        {
            var list = new List<ContextSection>();
            foreach (var item in Json.Arr(o, "sections") ?? new List<object>())
            {
                var s = new ContextSection { Kind = Json.Str(item, "kind"), Id = Json.Str(item, "id"), Eyebrow = Json.Str(item, "eyebrow", ""), Title = Json.Str(item, "title", ""), Subtitle = Json.Str(item, "subtitle", "") };
                foreach (var a in Json.Arr(item, "actions") ?? new List<object>())
                    s.Actions.Add(new ContextAction { Label = Json.Str(a, "label", ""), Disabled = Json.Bool(a, "disabled"), Client = Json.Str(a, "client"), Command = Json.Obj(a, "command") });
                foreach (var n in Json.Arr(item, "notes") ?? new List<object>()) if (n is string text) s.Notes.Add(text);
                list.Add(s);
            }
            return list;
        }
    }
}

namespace Yunshan.Core.Host
{
    /// <summary>Overview panes (src/native-host/panes-model.ts).</summary>
    public sealed class Pane
    {
        public sealed class Row { public string Label, Value; }
        public sealed class Entry { public string Id, Title, Subtitle; public List<string> Detail = new List<string>(); public List<ContextAction> Actions = new List<ContextAction>(); }
        public sealed class Section { public string Title; public List<Row> Rows = new List<Row>(); public List<Entry> Entries = new List<Entry>(); public List<ContextAction> Actions = new List<ContextAction>(); public List<string> Notes = new List<string>(); }
        public string Id, Title; public List<Section> Sections = new List<Section>();

        static List<ContextAction> Actions(object o, string key)
        {
            var list = new List<ContextAction>();
            foreach (var a in Json.Arr(o, key) ?? new List<object>()) list.Add(new ContextAction { Label = Json.Str(a, "label", ""), Disabled = Json.Bool(a, "disabled"), Client = Json.Str(a, "client"), Command = Json.Obj(a, "command") });
            return list;
        }
        static List<string> Strings(object o, string key) { var list = new List<string>(); foreach (var s in Json.Arr(o, key) ?? new List<object>()) if (s is string text) list.Add(text); return list; }

        public static List<Pane> ListFrom(object o)
        {
            var panes = new List<Pane>();
            foreach (var p in Json.Arr(o, "panes") ?? new List<object>())
            {
                var pane = new Pane { Id = Json.Str(p, "id"), Title = Json.Str(p, "title", "") };
                foreach (var s in Json.Arr(p, "sections") ?? new List<object>())
                {
                    var section = new Section { Title = Json.Str(s, "title", ""), Actions = Actions(s, "actions"), Notes = Strings(s, "notes") };
                    foreach (var r in Json.Arr(s, "rows") ?? new List<object>()) section.Rows.Add(new Row { Label = Json.Str(r, "label", ""), Value = Json.Str(r, "value", "") });
                    foreach (var e in Json.Arr(s, "entries") ?? new List<object>()) section.Entries.Add(new Entry { Id = Json.Str(e, "id"), Title = Json.Str(e, "title", ""), Subtitle = Json.Str(e, "subtitle", ""), Detail = Strings(e, "detail"), Actions = Actions(e, "actions") });
                    pane.Sections.Add(section);
                }
                panes.Add(pane);
            }
            return panes;
        }
    }
}
