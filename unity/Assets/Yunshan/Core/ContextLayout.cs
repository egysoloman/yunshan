using System;
using System.Collections.Generic;
using System.Linq;
using Yunshan.Core.Host;

namespace Yunshan.Core
{
    /// <summary>Context panel layout rules shared with the web panel (display only).
    /// Port of src/transit-label.ts stoppedVehicleFirst and src/place-services.ts placeServicesSummary.</summary>
    public static class ContextLayout
    {
        public const double BoardingReach = 8;
        public const int PlaceServicesShown = 4;

        /// <summary>A vehicle stopped to board within reach, nearer than the building door, comes first:
        /// E boards it and the panel opens on it.</summary>
        public static bool StoppedVehicleFirst(Vec3 player, string state, Vec3 vehicle, Vec3 door)
        {
            if (state != "waiting" && state != "boarding") return false;
            double toVehicle = Distance(player, vehicle);
            return toVehicle <= BoardingReach && (door == null || toVehicle < Distance(player, door));
        }

        /// <summary>What E does beside a stopped vehicle follows the tab the panel shows (web transit-label.ts
        /// eBoardsVehicle): never on the place tab, a stopped vehicle within reach on the vehicle tab, otherwise
        /// StoppedVehicleFirst.</summary>
        public static bool EBoardsVehicle(Vec3 player, string state, Vec3 vehicle, Vec3 door, string shown)
        {
            if (shown == "building") return false;
            if (shown == "vehicle") return StoppedVehicleFirst(player, state, vehicle, null);
            return StoppedVehicleFirst(player, state, vehicle, door);
        }

        /// <summary>One line naming what a place offers, seen from the street.</summary>
        public static string PlaceServicesSummary(IEnumerable<string> labels)
        {
            var names = labels.Select(label => label.Split(new[] { " · " }, StringSplitOptions.None)[0].Split('，')[0].Trim()).Where(n => n.Length > 0).Distinct().ToList();
            if (names.Count == 0) return "这里可办理的事项";
            string shown = string.Join(" · ", names.Take(PlaceServicesShown));
            return $"这里可办理：{shown}{(names.Count > PlaceServicesShown ? $" 等 {names.Count} 项" : "")}";
        }

        /// <summary>From the street, when none of a place's service buttons can be used yet, they fold
        /// into one summary line (the enter button stays). Inside, or with any usable service, nothing folds.</summary>
        public static bool FoldsServices(ContextSection section, bool inside)
        {
            if (inside || section.Kind != "building") return false;
            var services = section.Actions.Where(a => a.Client != "interact").ToList();
            return services.Count > 0 && services.All(a => a.Disabled);
        }

        static double Distance(Vec3 a, Vec3 b) => Math.Sqrt((a.X - b.X) * (a.X - b.X) + (a.Y - b.Y) * (a.Y - b.Y) + (a.Z - b.Z) * (a.Z - b.Z));
    }
}
