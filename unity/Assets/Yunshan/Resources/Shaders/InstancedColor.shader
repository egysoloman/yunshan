// Built-in render pipeline: lit boxes drawn with Graphics.DrawMeshInstanced,
// one colour per instance (citizens, vehicles, signals). _Emission makes the
// instance colour self-lit (signal lamps).
Shader "Yunshan/InstancedColor"
{
    Properties
    {
        _Glossiness ("Smoothness", Range(0,1)) = 0.1
        _Emission ("Emission", Range(0,4)) = 0
    }
    SubShader
    {
        Tags { "RenderType"="Opaque" }
        LOD 200
        CGPROGRAM
        #pragma surface surf Standard fullforwardshadows addshadow
        #pragma multi_compile_instancing
        #pragma target 3.5
        struct Input { float3 worldPos; };
        half _Glossiness;
        half _Emission;
        UNITY_INSTANCING_BUFFER_START(Props)
            UNITY_DEFINE_INSTANCED_PROP(fixed4, _Color)
        UNITY_INSTANCING_BUFFER_END(Props)
        void surf (Input IN, inout SurfaceOutputStandard o)
        {
            fixed4 c = UNITY_ACCESS_INSTANCED_PROP(Props, _Color);
            o.Albedo = c.rgb;
            o.Metallic = 0;
            o.Smoothness = _Glossiness;
            o.Emission = c.rgb * _Emission;
        }
        ENDCG
    }
    FallBack "Diffuse"
}
