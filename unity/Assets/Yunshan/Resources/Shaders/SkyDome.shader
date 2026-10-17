// The web sky shader's gradient (src/renderer.ts skyMaterial, without clouds):
// horizon → top by pow(max(dir.y, 0), 0.4), on the studio dome ENV-110. No fog.
Shader "Yunshan/SkyDome"
{
    Properties { _Top ("Top", Color) = (0.25, 0.55, 0.69, 1) _Horizon ("Horizon", Color) = (0.74, 0.84, 0.87, 1) }
    SubShader
    {
        Tags { "Queue"="Background" "RenderType"="Background" }
        Cull Off ZWrite Off
        Pass
        {
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #include "UnityCG.cginc"
            fixed4 _Top, _Horizon;
            struct v2f { float4 pos : SV_POSITION; float3 local : TEXCOORD0; };
            v2f vert (float4 vertex : POSITION) { v2f o; o.pos = UnityObjectToClipPos(vertex); o.local = vertex.xyz; return o; }
            fixed4 frag (v2f i) : SV_Target { float h = pow(max(normalize(i.local).y, 0), .4); return lerp(_Horizon, _Top, h); }
            ENDCG
        }
    }
}
