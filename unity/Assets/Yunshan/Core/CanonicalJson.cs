// Canonical JSON (sorted keys, JavaScript number/string formatting) used for
// byte-for-byte comparisons with the TypeScript reference and for hashing.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Linq;
using System.Text;

namespace Yunshan.Core
{
    public static class CanonicalJson
    {
        /// <summary>Object node: null members are omitted (JS undefined).</summary>
        public sealed class Obj : Dictionary<string, object>
        {
            public Obj Put(string key, object value) { if (value != null) this[key] = value; return this; }
        }

        public static string Write(object value) { var sb = new StringBuilder(); WriteValue(sb, value); return sb.ToString(); }

        static void WriteValue(StringBuilder sb, object value)
        {
            switch (value)
            {
                case null: sb.Append("null"); break;
                case string s: WriteString(sb, s); break;
                case bool b: sb.Append(b ? "true" : "false"); break;
                case double d: sb.Append(double.IsNaN(d) || double.IsInfinity(d) ? "null" : JsMath.ToJsString(d)); break;
                case int i: sb.Append(i.ToString(CultureInfo.InvariantCulture)); break;
                case long l: sb.Append(JsMath.ToJsString(l)); break;
                case Obj o:
                    sb.Append('{'); bool first = true;
                    foreach (var key in o.Keys.OrderBy(k => k, StringComparer.Ordinal))
                    {
                        if (!first) sb.Append(','); first = false;
                        WriteString(sb, key); sb.Append(':'); WriteValue(sb, o[key]);
                    }
                    sb.Append('}'); break;
                case System.Collections.IEnumerable list:
                    sb.Append('['); bool firstItem = true;
                    foreach (var item in list) { if (!firstItem) sb.Append(','); firstItem = false; WriteValue(sb, item); }
                    sb.Append(']'); break;
                default: throw new ArgumentException("Unsupported canonical JSON value " + value.GetType());
            }
        }

        /// <summary>JSON.stringify string quoting (non-ASCII is written as-is).</summary>
        static void WriteString(StringBuilder sb, string s)
        {
            sb.Append('"');
            foreach (char c in s)
            {
                switch (c)
                {
                    case '"': sb.Append("\\\""); break;
                    case '\\': sb.Append("\\\\"); break;
                    case '\b': sb.Append("\\b"); break;
                    case '\f': sb.Append("\\f"); break;
                    case '\n': sb.Append("\\n"); break;
                    case '\r': sb.Append("\\r"); break;
                    case '\t': sb.Append("\\t"); break;
                    default:
                        if (c < 0x20) sb.Append("\\u").Append(((int)c).ToString("x4", CultureInfo.InvariantCulture));
                        else sb.Append(c);
                        break;
                }
            }
            sb.Append('"');
        }

        public static Obj Vec(Vec3 v) => v == null ? null : new Obj().Put("x", v.X).Put("y", v.Y).Put("z", v.Z);

        public static Obj World(WorldDefinition w) => new Obj()
            .Put("layoutVersion", w.LayoutVersion).Put("seed", w.Seed).Put("voxelSize", w.VoxelSize).Put("size", w.Size)
            .Put("districts", w.Districts.Select(d => new Obj().Put("id", d.Id).Put("name", d.Name).Put("kind", d.Kind).Put("center", Vec(d.Center)).Put("radius", d.Radius).Put("color", d.Color).Put("population", d.Population)).ToList())
            .Put("buildings", w.Buildings.Select(Building).ToList())
            .Put("nodes", w.Nodes.Select(n => new Obj().Put("id", n.Id).Put("districtId", n.DistrictId).Put("name", n.Name).Put("position", Vec(n.Position)).Put("station", n.Station)).ToList())
            .Put("edges", w.Edges.Select(e => new Obj().Put("id", e.Id).Put("from", e.From).Put("to", e.To).Put("mode", e.Mode).Put("points", e.Points.Select(Vec).ToList()).Put("length", e.Length).Put("capacity", e.Capacity)).ToList())
            .Put("mountains", w.Mountains.Select(m => new Obj().Put("x", m.X).Put("z", m.Z).Put("height", m.Height).Put("radius", m.Radius)).ToList())
            .Put("spawn", Vec(w.Spawn))
            .Put("waterfall", new Obj().Put("top", Vec(w.Waterfall.Top)).Put("bottom", Vec(w.Waterfall.Bottom)).Put("width", w.Waterfall.Width))
            .Put("river", w.River.Select(Vec).ToList());

        static object Num(int? v) => v.HasValue ? (object)(double)v.Value : null;

        public static Obj Building(Building b) => new Obj()
            .Put("commercialRouteRevision", Num(b.CommercialRouteRevision)).Put("commercialGeometryRevision", Num(b.CommercialGeometryRevision)).Put("stairGeometryRevision", Num(b.StairGeometryRevision))
            .Put("floorPlanProfile", b.FloorPlanProfile)
            .Put("functionPoints", b.FunctionPoints?.Select(p => new Obj().Put("id", p.Id).Put("purpose", p.Purpose).Put("floor", (double)p.Floor).Put("position", Vec(p.Position))).ToList())
            .Put("floorFootprints", b.FloorFootprints?.Select(f => new Obj().Put("width", f.Width).Put("depth", f.Depth)).ToList())
            .Put("basements", Num(b.Basements)).Put("basementUses", b.BasementUses).Put("floorUses", b.FloorUses).Put("floorPermissions", b.FloorPermissions)
            .Put("facility", b.Facility).Put("publicFloors", Num(b.PublicFloors)).Put("requiredPermission", b.RequiredPermission)
            .Put("id", b.Id).Put("districtId", b.DistrictId).Put("name", b.Name).Put("kind", b.Kind).Put("position", Vec(b.Position))
            .Put("width", b.Width).Put("depth", b.Depth).Put("height", b.Height).Put("floors", (double)b.Floors).Put("rotation", b.Rotation)
            .Put("door", Vec(b.Door)).Put("capacity", b.Capacity).Put("seed", b.Seed);
    }
}
