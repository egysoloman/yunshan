using System.Collections.Generic;
// Port of src/access.ts (floor geometry part; permissions move with the player model).
namespace Yunshan.Core
{
    public static class Access
    {
        /// <summary>Actual occupiable footprint; underground rooms retain the structural base.</summary>
        public static Footprint GetFloorDimensions(Building building, int floor)
        {
            if (floor >= 0 && building.FloorFootprints != null && floor < building.FloorFootprints.Count && building.FloorFootprints[floor] != null) return building.FloorFootprints[floor];
            return new Footprint(building.Width, building.Depth);
        }

        /// <summary>The shared vertical shaft stays inside every level, including stepped towers.</summary>
        public static Vec3 GetStairPosition(Building building, int floor) =>
            ArchitectureFloorPlan.GetBuildingBody(building) != null ? ArchitectureFloorPlan.GetFloorPlanStairPosition(building, floor) : ArchitectureFloorPlan.RawStairPosition(building, floor);

        static readonly Dictionary<string, string[]> Packages = new Dictionary<string, string[]>
        {
            ["official"] = new[] { "official", "council", "scientist" },
            ["driver"] = new[] { "driver", "scientist", "official" },
            ["police"] = new[] { "police", "soldier", "official" },
            ["teacher"] = new[] { "teacher", "scientist", "official" },
            ["mayor"] = new string[0],
        };

        /// <summary>access.ts canAccessFloor: floor permissions by identity.</summary>
        public static bool CanAccessFloor(Building building, int floor, string role, IEnumerable<string> identities)
        {
            if (floor < -(building.Basements ?? 0) || floor >= building.Floors) return false;
            var set = new HashSet<string> { role };
            if (identities != null) foreach (var identity in identities) set.Add(identity);
            bool Has(params string[] roles) { foreach (var r in roles) if (set.Contains(r)) return true; return false; }
            if (floor < 0) return floor == -1 ? Has("mayor", "official", "police", "scientist", "teacher") : Has("mayor", "official");
            var permission = building.FloorPermissions != null && floor < building.FloorPermissions.Count ? building.FloorPermissions[floor] : null;
            if (permission == "public") return true;
            if (building.PublicFloors == null || floor < building.PublicFloors) return true;
            if (building.Id == "core-main" && floor == building.Floors - 1) return true;
            var required = permission ?? building.RequiredPermission;
            if (string.IsNullOrEmpty(required) || Has("mayor")) return true;
            return Has(Packages.TryGetValue(required, out var package) ? package : new[] { required });
        }
    }
}
