// Citizen heads: instanced skin colour plus a face-ink atlas (6 styles of
// 32×16; right half of each cell is ink). Ink with alpha < .88 replaces skin.
Shader "Yunshan/CitizenFace"
{
    Properties
    {
        _FaceTex ("Face atlas", 2D) = "white" {}
        _Glossiness ("Smoothness", Range(0,1)) = 0.04
    }
    SubShader
    {
        Tags { "RenderType"="Opaque" }
        LOD 200
        CGPROGRAM
        #pragma surface surf Standard fullforwardshadows addshadow
        #pragma multi_compile_instancing
        #pragma target 3.5
        sampler2D _FaceTex;
        half _Glossiness;
        struct Input { float2 uv_FaceTex; };
        UNITY_INSTANCING_BUFFER_START(Props)
            UNITY_DEFINE_INSTANCED_PROP(fixed4, _Color)
            UNITY_DEFINE_INSTANCED_PROP(float, _FaceStyle)
        UNITY_INSTANCING_BUFFER_END(Props)
        void surf (Input IN, inout SurfaceOutputStandard o)
        {
            fixed4 skin = UNITY_ACCESS_INSTANCED_PROP(Props, _Color);
            float style = UNITY_ACCESS_INSTANCED_PROP(Props, _FaceStyle);
            float2 uv = float2((IN.uv_FaceTex.x + style) / 6.0, IN.uv_FaceTex.y);
            fixed4 ink = tex2D(_FaceTex, uv);
            o.Albedo = ink.a < 0.88 ? ink.rgb : skin.rgb;
            o.Metallic = 0;
            o.Smoothness = _Glossiness;
        }
        ENDCG
    }
    FallBack "Diffuse"
}
