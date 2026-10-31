// World data contract shared by every module (port of src/types.ts world part).
// Classes keep JavaScript reference semantics: code that copies with {...a}
// in TypeScript calls Copy() here; code that mutates shared objects mutates.
using System.Collections.Generic;

namespace Yunshan.Core
{
    public sealed class Vec3
    {
        public double X, Y, Z;
        public Vec3() { }
        public Vec3(double x, double y, double z) { X = x; Y = y; Z = z; }
        public Vec3 Copy() => new Vec3(X, Y, Z);
        public override string ToString() => $"({JsMath.ToJsString(X)},{JsMath.ToJsString(Y)},{JsMath.ToJsString(Z)})";
    }

    public sealed class District
    {
        public string Id, Name, Kind, Color;
        public Vec3 Center;
        public double Radius, Population;
    }

    public sealed class BuildingFunctionPoint
    {
        public string Id, Purpose; // 'work' | 'service' | 'sale'
        public int Floor;
        public Vec3 Position;
    }

    public sealed class Footprint
    {
        public double Width, Depth;
        public Footprint(double width, double depth) { Width = width; Depth = depth; }
    }

    public sealed class Building
    {
        public int? CommercialRouteRevision, CommercialGeometryRevision, StairGeometryRevision;
        public string FloorPlanProfile;
        public List<BuildingFunctionPoint> FunctionPoints;
        public List<Footprint> FloorFootprints;
        public int? Basements;
        public List<string> BasementUses, FloorUses, FloorPermissions;
        public string Facility;
        public int? PublicFloors;
        public string RequiredPermission;
        public string Id, DistrictId, Name, Kind;
        public Vec3 Position;
        public double Width, Depth, Height;
        public int Floors;
        public double Rotation;
        public Vec3 Door;
        public double Capacity;
        public double Seed;
    }

    public sealed class NetworkNode
    {
        public string Id, DistrictId, Name;
        public Vec3 Position;
        public bool Station;
    }

    public sealed class NetworkEdge
    {
        public string Id, From, To, Mode;
        public double Length, Capacity;
        public List<Vec3> Points;
    }

    public sealed class Mountain
    {
        public double X, Z, Height, Radius;
        public Mountain(double x, double z, double height, double radius) { X = x; Z = z; Height = height; Radius = radius; }
    }

    public sealed class Waterfall
    {
        public Vec3 Top, Bottom;
        public double Width;
    }

    public sealed class WorldDefinition
    {
        public string LayoutVersion;
        public double Seed, VoxelSize, Size;
        public List<District> Districts = new List<District>();
        public List<Building> Buildings = new List<Building>();
        public List<NetworkNode> Nodes = new List<NetworkNode>();
        public List<NetworkEdge> Edges = new List<NetworkEdge>();
        public List<Mountain> Mountains = new List<Mountain>();
        public Vec3 Spawn;
        public Waterfall Waterfall;
        public List<Vec3> River = new List<Vec3>();
    }
}
