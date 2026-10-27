// ---------- 1. Connect to the database (Supabase) ----------
// Copy these two values from your Supabase project (Connect button).
const SUPABASE_URL = "https://jwablhofwtepfvpcghrm.supabase.co";
const SUPABASE_KEY = "sb_publishable_W0X9MzyYR7OdGzkBTrepwQ_PpdpYIMw";

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

// ---------- 2. Grab the elements we need ----------
const authScreen = document.getElementById("auth-screen");
const chatScreen = document.getElementById("chat-screen");
const authForm = document.getElementById("auth-form");
const authMessage = document.getElementById("auth-message");
const displayName = document.getElementById("display-name");
const emailInput = document.getElementById("email");
const passwordInput = document.getElementById("password");
const signupBtn = document.getElementById("signup-btn");
const logoutBtn = document.getElementById("logout-btn");
const who = document.getElementById("who");
const onlineUsers = document.getElementById("online-users");
const messageList = document.getElementById("messages");
const messageForm = document.getElementById("message-form");
const messageInput = document.getElementById("message-input");

// ---------- 3. What the app remembers while it runs ----------
let currentUser = null; // the logged-in user, or null
const names = {}; // user id -> display name
let channel = null; // the realtime connection (used in Part 4)

// ---------- 4. Sign up, log in, log out ----------
async function signUp() {
  const name = displayName.value.trim();
  if (name.length < 2) {
    authMessage.textContent = "Enter a display name (2 to 24 characters).";
    return;
  }

  authMessage.textContent = "Creating your account...";
  const { data, error } = await sb.auth.signUp({
    email: emailInput.value.trim(),
    password: passwordInput.value,
    options: { data: { display_name: name } },
  });

  if (error) {
    authMessage.textContent = error.message;
  } else if (!data.session) {
    authMessage.textContent = "Check your email to confirm your account.";
  } else {
    authMessage.textContent = "";
  }
}

async function logIn() {
  authMessage.textContent = "Logging in...";
  const { error } = await sb.auth.signInWithPassword({
    email: emailInput.value.trim(),
    password: passwordInput.value,
  });
  authMessage.textContent = error ? error.message : "";
}

authForm.addEventListener("submit", (event) => {
  event.preventDefault(); // stop the page from reloading
  logIn();
});

signupBtn.addEventListener("click", () => {
  if (authForm.reportValidity()) signUp();
});

logoutBtn.addEventListener("click", () => sb.auth.signOut());

// ---------- 5. React when the login state changes ----------
sb.auth.onAuthStateChange((event, session) => {
  const user = session ? session.user : null;

  // setTimeout lets Supabase finish its own work before we call it again
  setTimeout(() => {
    if (user && (!currentUser || currentUser.id !== user.id)) startChat(user);
    if (!user && currentUser) stopChat();
  }, 0);
});

// ---------- 6. Start and stop the chat room ----------
async function startChat(user) {
  currentUser = user;
  authScreen.hidden = true;
  chatScreen.hidden = false;
  who.textContent = "Loading...";
  onlineUsers.textContent = "Online: loading...";

  await loadNames();
  who.textContent = names[user.id] || "Signed in";
  await loadMessages();
  listenForNewMessages();
  messageInput.focus();
}

function stopChat() {
  currentUser = null;
  if (channel) sb.removeChannel(channel);
  channel = null;
  onlineUsers.textContent = "Online: nobody";
  messageList.innerHTML = "";
  passwordInput.value = "";
  chatScreen.hidden = true;
  authScreen.hidden = false;
}

// ---------- 7. Show one message on the screen ----------
function showMessage(msg) {
  // Skip it if it is already on the screen (this matters in Part 4)
  if (messageList.querySelector('[data-id="' + msg.id + '"]')) return;

  const isMine = msg.user_id === currentUser.id;
  const item = document.createElement("li");
  item.className = isMine ? "message mine" : "message";
  item.dataset.id = msg.id;

  const author = document.createElement("span");
  author.className = "author";
  author.textContent = names[msg.user_id] || "Unknown";

  const text = document.createElement("p");
  // textContent (not innerHTML) keeps the page safe from injected HTML
  text.textContent = msg.content;

  const time = document.createElement("time");
  time.textContent = new Date(msg.created_at).toLocaleTimeString([], {
    hour: "numeric",
    minute: "2-digit",
  });

  item.append(author, text, time);

  if (isMine) {
    const actions = document.createElement("div");
    actions.className = "message-actions";

    const unsendButton = document.createElement("button");
    unsendButton.type = "button";
    unsendButton.className = "unsend";
    unsendButton.textContent = "Unsend";
    unsendButton.setAttribute("aria-label", "Unsend this message");
    actions.appendChild(unsendButton);
    item.appendChild(actions);
  }

  messageList.appendChild(item);
  messageList.scrollTop = messageList.scrollHeight;
}

messageList.addEventListener("click", async (event) => {
  const button = event.target.closest("button.unsend");
  if (!button || !currentUser) return;

  const item = button.closest(".message");
  if (!item || !item.dataset.id) return;
  button.disabled = true;

  const { data, error } = await sb
    .from("messages")
    .delete()
    .eq("id", item.dataset.id)
    .eq("user_id", currentUser.id)
    .select("id")
    .single();

  if (error) {
    console.error("Could not unsend message:", error);
    button.disabled = false;
    alert("Could not unsend: " + error.message);
    return;
  }
  removeMessage(data.id);
});

// ---------- 8. Send a message to the database (INSERT) ----------
messageForm.addEventListener("submit", async (event) => {
  event.preventDefault();

  const content = messageInput.value.trim();
  if (content === "") return;
  messageInput.value = "";

  // Commands such as /weather stay on your screen. They are not saved.
  if (content.startsWith("/")) {
    handleCommand(content);
    return;
  }

  // We send ONLY the text. The database fills in who sent it.
  const { data, error } = await sb
    .from("messages")
    .insert({ content: content })
    .select()
    .single();

  if (error) {
    alert("Could not send: " + error.message);
    messageInput.value = content;
    return;
  }
  showMessage(data);
});

// ---------- 9. Read data from the database (SELECT) ----------
async function loadNames() {
  const { data, error } = await sb
    .from("profiles")
    .select("id, display_name");
  if (error) return console.error(error);

  data.forEach((p) => {
    names[p.id] = p.display_name;
  });
}

async function loadMessages() {
  const { data, error } = await sb
    .from("messages")
    .select("id, user_id, content, created_at")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) return console.error(error);

  messageList.innerHTML = "";
  data.reverse().forEach(showMessage);
}

// ---------- 10. Get new messages instantly (Realtime) ----------
async function nameFor(userId) {
  if (!names[userId]) {
    const { data } = await sb
      .from("profiles")
      .select("display_name")
      .eq("id", userId)
      .single();
    names[userId] = data ? data.display_name : "Unknown";
  }
  return names[userId];
}

function listenForNewMessages() {
  if (channel) sb.removeChannel(channel);

  channel = sb
    .channel("class-chat")
    .on("presence", { event: "sync" }, renderOnlineUsers)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages" },
      async (payload) => {
        await nameFor(payload.new.user_id);
        showMessage(payload.new);
      }
    )
    .on(
      "postgres_changes",
      { event: "DELETE", schema: "public", table: "messages" },
      (payload) => removeMessage(payload.old.id)
    )
    .subscribe(async (status) => {
      if (status !== "SUBSCRIBED") {
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.error("Realtime channel status:", status);
        }
        return;
      }

      const trackStatus = await channel.track({
        user_id: currentUser.id,
        display_name: names[currentUser.id] || "Unknown",
      });
      if (trackStatus !== "ok") {
        console.error("Could not publish online presence:", trackStatus);
      }
    });
}

function removeMessage(id) {
  const item = messageList.querySelector('[data-id="' + id + '"]');
  if (item) item.remove();
}

function renderOnlineUsers() {
  if (!channel) return;

  const users = [];
  Object.values(channel.presenceState()).forEach((presences) => {
    presences.forEach((presence) => {
      const name = presence.display_name || names[presence.user_id] || "Unknown";
      if (!users.includes(name)) users.push(name);
    });
  });

  onlineUsers.textContent = users.length
    ? "Online: " + users.join(", ")
    : "Online: nobody";
}

// ---------- 11. API: a private weather bot (GET) ----------
const GEO_URL = "https://geocoding-api.open-meteo.com/v1/search";
const WEATHER_URL = "https://api.open-meteo.com/v1/forecast";

function describeWeather(code) {
  if (code === 0) return "clear sky";
  if (code <= 3) return "partly cloudy";
  if (code <= 48) return "foggy";
  if (code <= 57) return "drizzle";
  if (code <= 67) return "rain";
  if (code <= 77) return "snow";
  if (code <= 82) return "rain showers";
  if (code <= 86) return "snow showers";
  return "thunderstorm";
}

async function getWeather(city) {
  // Request 1: turn the city name into latitude and longitude
  const geoUrl = GEO_URL + "?name=" + encodeURIComponent(city) + "&count=1";
  const geoResponse = await fetch(geoUrl);
  if (!geoResponse.ok) throw new Error("Geocoding failed");
  const geoData = await geoResponse.json();

  if (!geoData.results) {
    return "Sorry, I could not find a city named " + city + ".";
  }
  const place = geoData.results[0];

  // Request 2: ask for the current weather at those coordinates
  const weatherUrl =
    WEATHER_URL +
    "?latitude=" + place.latitude +
    "&longitude=" + place.longitude +
    "&current=temperature_2m,weather_code,wind_speed_10m";
  const weatherResponse = await fetch(weatherUrl);
  if (!weatherResponse.ok) throw new Error("Weather failed");
  const weatherData = await weatherResponse.json();
  const now = weatherData.current;

  return (
    place.name + ", " + place.country + ": " +
    now.temperature_2m + " degrees C, " +
    describeWeather(now.weather_code) + ", wind " +
    now.wind_speed_10m + " km/h"
  );
}

async function getCityTime(city) {
  const geoUrl = GEO_URL + "?name=" + encodeURIComponent(city) + "&count=1";
  const geoResponse = await fetch(geoUrl);
  if (!geoResponse.ok) throw new Error("Geocoding failed");
  const geoData = await geoResponse.json();

  if (
    !geoData.results ||
    geoData.results.length === 0 ||
    !geoData.results[0].timezone
  ) {
    return "Sorry, I could not find a timezone for " + city + ".";
  }

  const place = geoData.results[0];
  const time = new Intl.DateTimeFormat([], {
    timeZone: place.timezone,
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  }).format(new Date());

  return "The current time in " + place.name + ", " + place.country + " is " + time + ".";
}

async function handleCommand(text) {
  const words = text.split(" ");
  const command = words[0].toLowerCase();
  if (command !== "/weather" && command !== "/time") {
    showBotMessage("Unknown command. Try: /weather Manila or /time Manila");
    return;
  }

  const city = words.slice(1).join(" ").trim();
  if (city === "") {
    showBotMessage("Try it like this: " + command + " Manila");
    return;
  }

  try {
    showBotMessage(command === "/time" ? await getCityTime(city) : await getWeather(city));
  } catch (error) {
    console.error(error);
    showBotMessage(
      command === "/time"
        ? "The time service is not answering right now."
        : "The weather service is not answering right now."
    );
  }
}

function showBotMessage(text) {
  const item = document.createElement("li");
  item.className = "message bot";

  const author = document.createElement("span");
  author.className = "author";
  author.textContent = "WeatherBot (only you can see this)";

  const body = document.createElement("p");
  body.textContent = text;

  item.append(author, body);
  messageList.appendChild(item);
  messageList.scrollTop = messageList.scrollHeight;
}
