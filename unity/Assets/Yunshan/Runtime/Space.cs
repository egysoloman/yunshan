using UnityEngine;
using Yunshan.Core;

namespace Yunshan.Runtime
{
    /// <summary>Game space is right-handed (as Three.js and glTF); Unity is
    /// left-handed. glTFast imports glTF by negating X, so game positions map
    /// the same way and yaw angles change sign. Keep every conversion here.</summary>
    public static class Space
    {
        public static Vector3 ToUnity(Vec3 v) => new Vector3(-(float)v.X, (float)v.Y, (float)v.Z);
        public static Vector3 ToUnity(double x, double y, double z) => new Vector3(-(float)x, (float)y, (float)z);
        public static Vec3 ToGame(Vector3 v) => new Vec3(-v.x, v.y, v.z);
        /// <summary>Game yaw (radians, right-handed about +Y) to a Unity rotation.</summary>
        public static Quaternion Yaw(double radians) => Quaternion.Euler(0, -(float)(radians * Mathf.Rad2Deg), 0);

        public static Color Hex(string hex)
        {
            ColorUtility.TryParseHtmlString(hex, out var c);
            return QualitySettings.activeColorSpace == ColorSpace.Linear ? c.linear : c;
        }
    }
}
