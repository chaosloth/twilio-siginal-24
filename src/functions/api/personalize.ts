// Imports global types
import "@twilio-labs/serverless-runtime-types";
// Fetches specific types
import {
  Context,
  ServerlessCallback,
  ServerlessFunctionSignature,
} from "@twilio-labs/serverless-runtime-types/types";
import { profile } from "console";

const { OpenAI } = require("openai");

// Use Node Fetch
const fetch = require("node-fetch");

type MyEvent = {
  phone: string;
  filter?: string;
};

type Result = {
  profile?: { [key: string]: string };
  history?: [];
  recommendation?: {
    suggested_activity_name: string;
    suggested_activity_address: string;
    suggested_restaurant_name: string;
    suggested_restaurant_address: string;
  };
};

// If you want to use environment variables, you will need to type them like
// this and add them to the Context in the function signature as
// Context<MyContext> as you see below.
type MyContext = {
  SEGMENT_API_ACCESS_TOKEN: string;
  SEGMENT_PROFILES_API_BASE_URL: string;
  SEGMENT_SPACE_ID: string;
  OPENAI_API_KEY: string;
  OPENAI_MODEL: string;
};

export const handler: ServerlessFunctionSignature<MyContext, MyEvent> =
  async function (
    context: Context<MyContext>,
    event: MyEvent,
    callback: ServerlessCallback
  ) {
    console.log(`Incoming Personalisation Request >> `, event);
    const response = new Twilio.Response();
    try {
      if (!event.phone) {
        response.setStatusCode(400);
        response.setBody({ status: "Missing request parameters" });
        return callback(null, response);
      }

      let token = Buffer.from(
        `${context.SEGMENT_API_ACCESS_TOKEN}:`,
        "utf8"
      ).toString("base64");

      const userId = encodeURIComponent(event.phone);

      const startsWithClient = /^client:/i.test(event.phone);
      const lookup_type = startsWithClient ? "client_id" : "phone";

      const profile_url = `${context.SEGMENT_PROFILES_API_BASE_URL}/spaces/${context.SEGMENT_SPACE_ID}/collections/users/profiles/${lookup_type}:${userId}/traits?limit=200`;
      const events_url = `${context.SEGMENT_PROFILES_API_BASE_URL}/spaces/${context.SEGMENT_SPACE_ID}/collections/users/profiles/${lookup_type}:${userId}/events?limit=5`;

      var options = {
        method: "GET",
        headers: {
          Authorization: `Basic ${token}`,
        },
      };

      const [resolvedProfile, resolvedEvents] = await Promise.all([
        fetch(profile_url, options).then(
          async (res: { json: () => any }) => await res.json()
        ),
        fetch(events_url, options).then(
          async (res: { json: () => any }) => await res.json()
        ),
      ]);

      console.log(`Have fetched results`);

      // Guard clause for profile
      if (!resolvedProfile || !resolvedProfile.hasOwnProperty("traits")) {
        response.setStatusCode(404);
        response.setBody({ status: "Profile not found" });
        return callback(null, response);
      }

      let result: Result = {
        profile: resolvedProfile.traits,
      };

      if (event.filter && (event.filter === "true" || event.filter === "yes")) {
        console.log(`Filtering...`);
        const filterKeyNames = [
          "address",
          "company",
          "demo",
          "destination_preference",
          "email",
          "name",
          "last_order_summary",
          "phone",
          "music_preference",
          "favourite_colour",
          "carbs_preference",
          "food_restrictions",
          "food_style",
          "spice_level",
        ];

        if (result.profile) {
          result.profile = Object.keys(result.profile)
            .filter((key) => filterKeyNames.includes(key))
            .reduce((obj: { [key: string]: string }, key) => {
              obj[key] = result.profile![key];
              return obj;
            }, {});
        }
      }

      for (const key in result.profile) {
        if (key.startsWith("j_o")) {
          delete result.profile[key];
        }
      }

      if (
        resolvedEvents &&
        resolvedEvents.hasOwnProperty("data") &&
        Array.isArray(resolvedEvents.data)
      ) {
        console.log("Filtering events...");
        // Iterate through events
        result.history = resolvedEvents.data.map(
          (ev: { timestamp: any; type: any; event: any; properties: any }) => {
            console.log(`Event:`, ev);
            return {
              timestamp: ev.timestamp,
              type: ev.type,
              event: ev.event,
              ...ev.properties,
            };
          }
        );
      } else {
        result.history = [];
      }

      let userInfo = "My attributes are:";
      for (const key in result.profile) {
        const attributeName = key.replace(/_/g, " ");
        userInfo += `- ${attributeName}: ${result.profile[key]}`;
      }

      const suggestionInstructions = `You are a AI agent built by Twilio, you are assisting users make a choice about what to do whilst in Singapore, 
    during the Signal 2024 customer conference. You task is to recommend an activity based on what you know about the customer. 
    You MUST respond back with a JSON object based on this template 
    {
    "suggested_activity_name": "", // Name of the activity to do in Singapore
    "suggested_activity_address": "", // Physical address of the activity
    "suggested_restaurant_name":"",  // Name of the Restaurant to visit in Singapore
    "suggested_restaurant_address":"" // Physical address of the Restaurant
    }
    Do NOT use markdown syntax`;

      const openai = new OpenAI({
        apiKey: context.OPENAI_API_KEY,
      });

      const completionResult = await openai.chat.completions.create({
        model: context.OPENAI_MODEL,
        messages: [
          {
            role: "system",
            content: suggestionInstructions,
          },
          {
            role: "user",
            content: userInfo,
          },
        ],
      });

      console.log("OpenAI Completion", result);

      if (completionResult.choices[0].message.content) {
        const suggestionJson =
          completionResult.choices[0].message.content?.trim();

        console.log(`JSON RESP >> `, suggestionJson);
        let suggestion = {};
        try {
          suggestion = JSON.parse(suggestionJson);
          result.recommendation = suggestion as typeof result.recommendation;
        } catch (err) {
          console.log("Error parsing results from AI - probably no action");
        }
      }

      console.log(`Profile`, JSON.stringify(result, null, 2));
      response.appendHeader("Content-Type", "application/json");
      response.setBody(result);

      return callback(null, response);
    } catch (err: any) {
      console.log(`Error fetching profile`, err);
      return callback(err);
    }
  };
