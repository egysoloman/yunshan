using System.Collections.Generic;
using System.Linq;

namespace Yunshan.Core.Host
{
    /// <summary>The city the simulation host is running, as it sent it (`world`
    /// op, canonical JSON of the TypeScript world). Unity draws this world
    /// instead of regenerating it in C#: the rebuilt current-v8 recipe exists
    /// only in TypeScript (docs/设计/世界重建总方案.md §2.3). The inverse of
    /// <see cref="CanonicalJson.World"/>: writing the result back gives the
    /// same canonical text.</summary>
    public static class WorldJson
    {
        static List<object> List(object o, string key) => Json.Arr(o, key) ?? new List<object>();
        static int? OptionalInt(object o, string key) => o is Dictionary<string, object> d && d.TryGetValue(key, out var v) && v is double n ? (int?)(int)n : null;
        static List<string> Strings(object o, string key) => Json.Arr(o, key)?.Select(v => v as string).ToList();

        public static WorldDefinition FromJson(Dictionary<string, object> o)
        {
            var waterfall = Json.Obj(o, "waterfall");
            return new WorldDefinition
            {
                LayoutVersion = Json.Str(o, "layoutVersion"), Seed = Json.Num(o, "seed"), VoxelSize = Json.Num(o, "voxelSize"), Size = Json.Num(o, "size"),
                Districts = List(o, "districts").Select(d => new District { Id = Json.Str(d, "id"), Name = Json.Str(d, "name"), Kind = Json.Str(d, "kind"), Color = Json.Str(d, "color"), Center = Json.Vec(Json.Obj(d, "center")), Radius = Json.Num(d, "radius"), Population = Json.Num(d, "population") }).ToList(),
                Buildings = List(o, "buildings").Select(Building).ToList(),
                Nodes = List(o, "nodes").Select(n => new NetworkNode { Id = Json.Str(n, "id"), DistrictId = Json.Str(n, "districtId"), Name = Json.Str(n, "name"), Position = Json.Vec(Json.Obj(n, "position")), Station = Json.Bool(n, "station") }).ToList(),
                Edges = List(o, "edges").Select(e => new NetworkEdge { Id = Json.Str(e, "id"), From = Json.Str(e, "from"), To = Json.Str(e, "to"), Mode = Json.Str(e, "mode"), Length = Json.Num(e, "length"), Capacity = Json.Num(e, "capacity"), Points = List(e, "points").Select(Json.Vec).ToList() }).ToList(),
                Mountains = List(o, "mountains").Select(m => new Mountain(Json.Num(m, "x"), Json.Num(m, "z"), Json.Num(m, "height"), Json.Num(m, "radius"))).ToList(),
                Spawn = Json.Vec(Json.Obj(o, "spawn")),
                Waterfall = new Waterfall { Top = Json.Vec(Json.Obj(waterfall, "top")), Bottom = Json.Vec(Json.Obj(waterfall, "bottom")), Width = Json.Num(waterfall, "width") },
                River = List(o, "river").Select(Json.Vec).ToList(),
            };
        }

        static Building Building(object b) => new Building
        {
            CommercialRouteRevision = OptionalInt(b, "commercialRouteRevision"), CommercialGeometryRevision = OptionalInt(b, "commercialGeometryRevision"), StairGeometryRevision = OptionalInt(b, "stairGeometryRevision"),
            FloorPlanProfile = Json.Str(b, "floorPlanProfile"),
            FunctionPoints = Json.Arr(b, "functionPoints")?.Select(p => new BuildingFunctionPoint { Id = Json.Str(p, "id"), Purpose = Json.Str(p, "purpose"), Floor = (int)Json.Num(p, "floor"), Position = Json.Vec(Json.Obj(p, "position")) }).ToList(),
            FloorFootprints = Json.Arr(b, "floorFootprints")?.Select(f => new Footprint(Json.Num(f, "width"), Json.Num(f, "depth"))).ToList(),
            Basements = OptionalInt(b, "basements"), BasementUses = Strings(b, "basementUses"), FloorUses = Strings(b, "floorUses"), FloorPermissions = Strings(b, "floorPermissions"),
            Facility = Json.Str(b, "facility"), PublicFloors = OptionalInt(b, "publicFloors"), RequiredPermission = Json.Str(b, "requiredPermission"),
            Id = Json.Str(b, "id"), DistrictId = Json.Str(b, "districtId"), Name = Json.Str(b, "name"), Kind = Json.Str(b, "kind"), Position = Json.Vec(Json.Obj(b, "position")),
            Width = Json.Num(b, "width"), Depth = Json.Num(b, "depth"), Height = Json.Num(b, "height"), Floors = (int)Json.Num(b, "floors"), Rotation = Json.Num(b, "rotation"),
            Door = Json.Vec(Json.Obj(b, "door")), Capacity = Json.Num(b, "capacity"), Seed = Json.Num(b, "seed"),
        };
    }
}
