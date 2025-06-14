/**
 * Copyright 2024 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { type FunctionDeclaration, SchemaType, Part } from "@google/generative-ai";
import React, { useEffect, useState, memo } from "react";
import { useLiveAPIContext } from "../../contexts/LiveAPIContext.tsx";
import { ToolCall } from "../../multimodal-live-types";

const geocodeDeclaration: FunctionDeclaration = {
  name: "geocode",
  description: "Geocodes an address string and returns the latitude and longitude.",
  parameters: {
    type: SchemaType.OBJECT,
    properties: {
      address: {
        type: SchemaType.STRING,
        description: "The address to geocode.",
      },
    },
    required: ["address"],
  },
};

const getMapDeclaration: FunctionDeclaration = {
    name: "get_map",
    description: "Returns a success message but then sends a map image afterwards.",
    parameters: {
        type: SchemaType.OBJECT,
        properties: {
            lat: { type: SchemaType.NUMBER, description: "Latitude." },
            lon: { type: SchemaType.NUMBER, description: "Longitude." },
            maptype: { type: SchemaType.STRING, description: "One of `roadmap`, `satellite`, `hybrid`, `terrain`." },
            zoom: { type: SchemaType.INTEGER, description: "Zoom level." },
            width: { type: SchemaType.INTEGER, description: "Image width by defualt go for 2048" },
            height: { type: SchemaType.INTEGER, description: "Image height by defualt go for 2048" },
            scale: { type: SchemaType.INTEGER, description: "Map scale." },
        },
        required: ["lat", "lon"],
    },
};

const GOOGLE_MAPS_API_KEY = process.env.REACT_APP_GOOGLE_MAPS_API_KEY as string;
if (typeof GOOGLE_MAPS_API_KEY !== "string") {
  throw new Error("set REACT_APP_GOOGLE_MAPS_API_KEY in .env");
}

const GEOCODING_API_URL = "https://maps.googleapis.com/maps/api/geocode/json";
const STATIC_MAP_API_URL = "https://maps.googleapis.com/maps/api/staticmap";


function MapsAgentComponent() {
  const [mapUrl, setMapUrl] = useState<string>("");
  const { client, setConfig } = useLiveAPIContext();

  useEffect(() => {
    setConfig({
      model: "models/gemini-2.0-flash-exp",
      generationConfig: {
        responseModalities: "audio",
      },
      systemInstruction: {
        parts: [
          {
            text:`You are a helpful maps agent.
            You can find the location of an address using the geocode tool.
            You can also generate a static map image for a given location using the get_map tool.
            No need to narrate the steps you used to get the map.YOu are a voice agent and your primary means is voice so unecessary reading or urls is not desired.
            When asked for a map, first find the coordinates using geocode, and then get the map using getmap tool which firslty will retunr a succuess message and then a message will shwo you the iamge. Only start your repsonse of get_map tool when you get an image.
            If a person tell you to go a little bit to the left or right, up or down just make adjustments to the map latitude and longitude directly  by very small magnitudes like 0.002 unless asked to make a bigger jumpand then use the get map tool to get hte new map.
            `,
          },
        ],
      },
      tools: [
        { functionDeclarations: [geocodeDeclaration, getMapDeclaration] },
      ],
    });
  }, [setConfig]);

  useEffect(() => {
    const onToolCall = async (toolCall: ToolCall) => {
      console.log(`Got tool call`, toolCall);
      
      const responses: { response: { output: any }; id: string }[] = [];
      let generatedMapUrl: string | null = null;

      for (const fc of toolCall.functionCalls) {
        if (fc.name === 'geocode') {
          const { address } = fc.args as { address: string };
          const params = new URLSearchParams({
            address: address,
            key: GOOGLE_MAPS_API_KEY,
          });
          const response = await fetch(`${GEOCODING_API_URL}?${params}`);
          const data = await response.json();
          if (data.status !== "OK" || !data.results) {
            console.error("Geocoding failed", data.error_message);
          } else {
            const location = data.results[0].geometry.location;
            responses.push({
              id: fc.id,
              response: {
                output: { latitude: location.lat, longitude: location.lng }
              }
            });
          }
        } else if (fc.name === 'get_map') {
          const { lat, lon, maptype = 'roadmap', zoom = 15, width = 600, height = 400, scale = 1 } = fc.args as { lat: number; lon: number; maptype?: string; zoom?: number; width?: number; height?: number; scale?: number; };
          const params = new URLSearchParams({
            center: `${lat},${lon}`,
            zoom: zoom.toString(),
            size: `${width}x${height}`,
            maptype: maptype,
            scale: scale.toString(),
            key: GOOGLE_MAPS_API_KEY,
          });
          const url = `${STATIC_MAP_API_URL}?${params}`;
          setMapUrl(url);
          generatedMapUrl = url;
          responses.push({
            id: fc.id,
            response: {
              output: { success: true }
            }
          });
        }
      }

      if (responses.length > 0) {
        client.sendToolResponse({ functionResponses: responses });
      }

      if (generatedMapUrl) {
        const imageResponse = await fetch(generatedMapUrl);
        const imageBlob = await imageResponse.blob();
        const reader = new FileReader();
        reader.readAsDataURL(imageBlob);
        reader.onloadend = () => {
          const base64data = (reader.result as string).split(',')[1];
          client.send([
            {
              inlineData: {
                mimeType: imageBlob.type,
                data: base64data,
              },
            },
          ]);
        };
      }
    };

    client.on("toolcall", onToolCall);
    return () => {
      client.off("toolcall", onToolCall);
    };
  }, [client]);

  return (
    <div className="maps-agent">
      {mapUrl ? (
        <div>
          <h2>Map</h2>
          <img src={mapUrl} alt="Map" />
        </div>
      ) : (
        <p>Maps Agent Desk</p>
      )}
    </div>
  );
}

export const MapsAgent = memo(MapsAgentComponent);
