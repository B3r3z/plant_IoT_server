const loginForm = document.getElementById('login-form');
const registerForm = document.getElementById('register-form');
const addPlantForm = document.getElementById('add-plant-form');
const authSection = document.getElementById('auth-section');
const plantSection = document.getElementById('plant-section');
const plantListDiv = document.getElementById('plant-list');
const logoutButton = document.getElementById('logout-button');
const loginError = document.getElementById('login-error');
const registerError = document.getElementById('register-error');
const registerSuccess = document.getElementById('register-success');
const addPlantError = document.getElementById('add-plant-error');
const userEmailDisplay = document.getElementById('user-email-display'); // Assuming you want to display email

const API_BASE_URL = ''; // Relative URLs work fine when served from Flask

// --- Helper Functions ---

function setToken(token) {
    localStorage.setItem('jwtToken', token);
}

function getToken() {
    return localStorage.getItem('jwtToken');
}

function removeToken() {
    localStorage.removeItem('jwtToken');
}

function showLoginError(message) {
    loginError.textContent = message;
    registerError.textContent = '';
    registerSuccess.textContent = '';
}

function showRegisterError(message) {
    registerError.textContent = message;
    loginError.textContent = '';
    registerSuccess.textContent = '';
}
function showRegisterSuccess(message) {
    registerSuccess.textContent = message;
    loginError.textContent = '';
    registerError.textContent = '';
}

function showAddPlantError(message) {
    addPlantError.textContent = message;
}

function clearErrors() {
    loginError.textContent = '';
    registerError.textContent = '';
    registerSuccess.textContent = '';
    addPlantError.textContent = '';
}

function showAuthSection() {
    authSection.classList.remove('hidden');
    plantSection.classList.add('hidden');
}

function showPlantSection() {
    authSection.classList.add('hidden');
    plantSection.classList.remove('hidden');
    fetchPlants(); // Fetch plants when showing the section
}

// --- API Call Functions ---

async function apiCall(endpoint, method = 'GET', body = null, requiresAuth = false) {
    const headers = { 'Content-Type': 'application/json' };
    const options = { method, headers };

    if (requiresAuth) {
        const token = getToken();
        if (!token) {
            console.error('Authentication required, but no token found.');
            showAuthSection(); // Redirect to login
            return null; // Or throw an error
        }
        headers['Authorization'] = `Bearer ${token}`;
    }

    if (body) {
        options.body = JSON.stringify(body);
    }

    try {
        const response = await fetch(API_BASE_URL + endpoint, options);
        const data = response.status !== 204 ? await response.json() : null; // Handle 204 No Content

        if (!response.ok) {
            console.error(`API Error (${response.status}):`, data);
            // Handle specific auth errors
            if (response.status === 401 && requiresAuth) {
                 console.log("Token expired or invalid. Logging out.");
                 logout();
                 return null;
            }
            // Return error data for handling in UI
            return { error: true, status: response.status, data: data };
        }
        return data;
    } catch (error) {
        console.error('Network or fetch error:', error);
        return { error: true, message: 'Network error. Please try again.' };
    }
}

// --- Authentication Logic ---

async function handleLogin(event) {
    event.preventDefault();
    clearErrors();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;

    const result = await apiCall('/auth/login', 'POST', { email, password });

    if (result && !result.error && result.access_token) {
        setToken(result.access_token);
        // TODO: Decode token to get user info if needed, or make another API call
        userEmailDisplay.textContent = email; // Placeholder
        showPlantSection();
        loginForm.reset();
    } else {
        showLoginError(result?.data?.msg || 'Login failed. Please check credentials.');
    }
}

async function handleRegister(event) {
    event.preventDefault();
    clearErrors();
    const email = document.getElementById('register-email').value;
    const password = document.getElementById('register-password').value;

    const result = await apiCall('/auth/register', 'POST', { email, password });

    if (result && !result.error) {
        showRegisterSuccess(result.msg || 'Registration successful! You can now log in.');
        registerForm.reset();
    } else {
        showRegisterError(result?.data?.msg || 'Registration failed.');
    }
}

function logout() {
    removeToken();
    plantListDiv.innerHTML = ''; // Clear plant list
    userEmailDisplay.textContent = '';
    showAuthSection();
}

// --- Plant Management Logic ---

async function fetchPlants() {
    plantListDiv.innerHTML = 'Loading plants...'; // Show loading state
    const plants = await apiCall('/api/plants', 'GET', null, true);

    if (plants && !plants.error) {
        renderPlants(plants);
    } else if (plants?.error && plants.status !== 401) { // Don't show error if it was an auth redirect
         plantListDiv.innerHTML = '<p class="error-message">Could not load plants.</p>';
    } else if (!plants) {
        // Auth error already handled by apiCall redirecting to login
         plantListDiv.innerHTML = '';
    }
}

async function fetchMeasurements(plantId) {
    const measurements = await apiCall(`/api/measurements/${plantId}`, 'GET', null, true);
    if (measurements && !measurements.error) {
        return measurements;
    }
    console.error(`Failed to fetch measurements for plant ${plantId}`);
    return []; // Return empty array on failure
}

async function handleManualWater(plantId) {
    console.log(`Requesting manual water for plant ${plantId}...`);
    const button = document.querySelector(`button[data-plant-id="${plantId}"]`);
    button.disabled = true;
    button.textContent = 'Watering...';

    const result = await apiCall(`/api/plants/${plantId}/water`, 'POST', { duration_ms: 5000 }, true); // Default 5s

    if (result && !result.error) {
        console.log(`Water command queued for plant ${plantId}`);
        // Maybe provide visual feedback - could update measurements after a delay
    } else {
        console.error(`Failed to send water command for plant ${plantId}`);
        alert(`Failed to send water command for plant ${plantId}.`); // Simple feedback
    }
    // Re-enable button after a short delay
    setTimeout(() => {
        button.disabled = false;
        button.textContent = 'Manual Water (5s)';
    }, 2000);
}


async function renderPlants(plants) {
    plantListDiv.innerHTML = ''; // Clear previous list or loading message
    if (plants.length === 0) {
        plantListDiv.innerHTML = '<p>No plants found. Add one below!</p>';
        return;
    }

    for (const plant of plants) {
        const plantCard = document.createElement('div');
        plantCard.className = 'plant-card';
        plantCard.innerHTML = `
            <h4>${plant.name} (ID: ${plant.id})</h4>
            <div class="plant-measurements" id="measurements-${plant.id}">Loading measurements...</div>
            <button data-plant-id="${plant.id}">Manual Water (5s)</button>
        `;
        plantListDiv.appendChild(plantCard);

        // Add event listener for the water button
        const waterButton = plantCard.querySelector(`button[data-plant-id="${plant.id}"]`);
        waterButton.addEventListener('click', () => handleManualWater(plant.id));


        // Fetch and display measurements for this plant
        const measurements = await fetchMeasurements(plant.id);
        const measurementsDiv = document.getElementById(`measurements-${plant.id}`);
        if (measurements.length > 0) {
            const latest = measurements[0]; // Assuming latest is first
             measurementsDiv.innerHTML = `
                Latest Reading (ts: ${latest.ts}):<br>
                Moisture: ${latest.moisture}% <br>
                Temp: ${latest.temperature}°C
            `;
        } else {
            measurementsDiv.innerHTML = 'No measurements found.';
        }
    }
}


async function handleAddPlant(event) {
    event.preventDefault();
    clearErrors();
    const name = document.getElementById('plant-name').value;

    const result = await apiCall('/api/plants', 'POST', { name }, true);

    if (result && !result.error) {
        console.log('Plant added:', result);
        addPlantForm.reset();
        fetchPlants(); // Refresh the plant list
    } else {
        showAddPlantError(result?.data?.error || 'Failed to add plant.');
    }
}


// --- Initialization ---

function init() {
    loginForm.addEventListener('submit', handleLogin);
    registerForm.addEventListener('submit', handleRegister);
    addPlantForm.addEventListener('submit', handleAddPlant);
    logoutButton.addEventListener('click', logout);

    const token = getToken();
    if (token) {
        // TODO: Optionally verify token validity with a backend endpoint
        // For now, assume it's valid and try fetching plants
        console.log("Token found, attempting to show plant section.");
        // Need user info - maybe store email in localStorage too after login?
        // Or add a /api/me endpoint to get user details
        userEmailDisplay.textContent = "Loading..."; // Placeholder
        apiCall('/api/plants', 'GET', null, true).then(plants => {
             if (plants && !plants.error) {
                 // If fetching plants worked, we are likely logged in
                 showPlantSection();
                 // Fetch user details if needed here
             } else {
                 // Token might be invalid/expired
                 console.log("Token invalid or fetching plants failed, showing auth.");
                 logout(); // Clear invalid token and show login
             }
         });

    } else {
        console.log("No token found, showing auth section.");
        showAuthSection();
    }
}

// Run initialization when the DOM is ready
document.addEventListener('DOMContentLoaded', init);
