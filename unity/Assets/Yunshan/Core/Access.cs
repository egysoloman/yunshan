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
    }
}
