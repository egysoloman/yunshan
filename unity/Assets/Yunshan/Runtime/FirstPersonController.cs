using UnityEngine;
using Yunshan.Core;

namespace Yunshan.Runtime
{
    /// <summary>First-person walking on the authoritative surfaces: feet height
    /// comes from World.GetWalkHeight and walls/fixtures from the shared floor
    /// plan (ArchitectureFloorPlan.BlocksFloorPlanMovement). Speeds match the
    /// web controller: 4.8 m/s walking, 10 m/s with Shift.</summary>
    public sealed class FirstPersonController : MonoBehaviour
    {
        public const float EyeHeight = 1.72f, BodyRadius = .35f, WalkSpeed = 4.8f, SprintSpeed = 10f;
        WorldDefinition world;
        Camera view;
        Vec3 feet;
        float yaw, pitch = -.1f;
        public Vec3 Feet => feet;

        public void Initialise(WorldDefinition world, Vec3 spawn, Camera camera)
        {
            this.world = world; view = camera; feet = spawn.Copy();
            Apply();
        }

        void Update()
        {
            if (world == null) return;
            if (Input.GetMouseButtonDown(0)) { Cursor.lockState = CursorLockMode.Locked; Cursor.visible = false; }
            if (Input.GetKeyDown(KeyCode.Escape)) { Cursor.lockState = CursorLockMode.None; Cursor.visible = true; }
            if (Cursor.lockState == CursorLockMode.Locked || Input.GetMouseButton(1))
            {
                yaw += Input.GetAxis("Mouse X") * 2.2f;
                pitch = Mathf.Clamp(pitch + Input.GetAxis("Mouse Y") * 2.2f, -85f, 85f);
            }
            float forward = (Input.GetKey(KeyCode.W) ? 1 : 0) - (Input.GetKey(KeyCode.S) ? 1 : 0);
            float strafe = (Input.GetKey(KeyCode.D) ? 1 : 0) - (Input.GetKey(KeyCode.A) ? 1 : 0);
            if (forward != 0 || strafe != 0)
            {
                float speed = Input.GetKey(KeyCode.LeftShift) || Input.GetKey(KeyCode.RightShift) ? SprintSpeed : WalkSpeed;
                // Unity yaw rotates the view about +Y; derive the move in Unity space then map back.
                var direction = Quaternion.Euler(0, yaw, 0) * new Vector3(strafe, 0, forward).normalized;
                var unityStep = direction * speed * Mathf.Min(Time.deltaTime, .1f);
                var target = new Vec3(feet.X - unityStep.x, feet.Y, feet.Z + unityStep.z);
                TryMove(target);
            }
            Apply();
        }

        void TryMove(Vec3 target)
        {
            double y = World.GetWalkHeight(world, target.X, target.Z, feet.Y);
            // A step higher than 0.6 m (stairs are 0.2 m treads) is a wall or ledge.
            if (y - feet.Y > .6) return;
            var to = new Vec3(target.X, y, target.Z);
            foreach (var b in world.Buildings)
            {
                if (System.Math.Abs(b.Position.X - feet.X) > b.Width / 2 + b.Depth / 2 + 4 || System.Math.Abs(b.Position.Z - feet.Z) > b.Width / 2 + b.Depth / 2 + 4) continue;
                if (ArchitectureFloorPlan.GetBuildingBody(b) == null) continue;
                int floor = (int)System.Math.Max(-(b.Basements ?? 0), System.Math.Min(b.Floors - 1, JsMath.Round((feet.Y - b.Position.Y - .6) / (b.Height / b.Floors))));
                if (ArchitectureFloorPlan.BlocksFloorPlanMovement(b, floor, feet, to, BodyRadius)) return;
            }
            feet = to;
        }

        void Apply()
        {
            if (view == null) return;
            view.transform.SetPositionAndRotation(Space.ToUnity(feet) + Vector3.up * EyeHeight, Quaternion.Euler(-pitch, yaw, 0));
        }
    }
}
