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

// Store chart instances { plantId: { humidityChart: Chart | null, temperatureChart: Chart | null } }
let plantCharts = {};

// --- Helper Functions ---

function setToken(token) {
    localStorage.setItem('jwtToken', token);
}

function getToken() {
    return localStorage.getItem('jwtToken');
}

function removeToken() {
    localStorage.removeItem('jwtToken');
    // Also remove cached email if we're storing it
    localStorage.removeItem('userEmail');
}

// New function to cache user email
function setUserEmail(email) {
    localStorage.setItem('userEmail', email);
    userEmailDisplay.textContent = email;
}

// New function to get cached email
function getUserEmail() {
    return localStorage.getItem('userEmail');
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

function logout() {
    removeToken();
    plantListDiv.innerHTML = ''; // Clear plant list
    userEmailDisplay.textContent = '';
    
    // Destroy all charts on logout
    Object.values(plantCharts).forEach(charts => {
        charts.humidityChart?.destroy();
        charts.temperatureChart?.destroy();
    });
    plantCharts = {}; // Clear the chart store
    
    showAuthSection();
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

async function fetchUserDetails() {
    const result = await apiCall('/api/me', 'GET', null, true);
    if (result && !result.error) {
        setUserEmail(result.email);
        return result;
    } 
    return null;
}

async function handleLogin(event) {
    event.preventDefault();
    clearErrors();
    const email = document.getElementById('login-email').value;
    const password = document.getElementById('login-password').value;

    const result = await apiCall('/auth/login', 'POST', { email, password });

    if (result && !result.error && result.access_token) {
        setToken(result.access_token);
        // Fetch user details to ensure we have the right email
        await fetchUserDetails();
        // If API fails, use the email from the login form as fallback
        if (!getUserEmail()) {
            setUserEmail(email);
        }
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
        // Sort measurements by timestamp ascending (oldest first) for charting
        // Since the backend returns in descending order (newest first), we need to reverse
        return measurements.reverse();
    }
    console.error(`Failed to fetch measurements for plant ${plantId}`);
    return []; // Return empty array on failure
}

// Function to format timestamp for chart labels
function formatChartLabel(timestamp) {
    const date = new Date(timestamp * 1000);
    return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

// Function to render or update charts for a specific plant
function renderCharts(plantId, measurements) {
    const humidityCanvas = document.getElementById(`humidity-chart-${plantId}`);
    const temperatureCanvas = document.getElementById(`temperature-chart-${plantId}`);
    const chartContainer = document.getElementById(`chart-container-${plantId}`);

    if (!humidityCanvas || !temperatureCanvas || !chartContainer) {
        console.error(`Canvas elements or container not found for plant ${plantId}`);
        return;
    }

    // Clear previous "No data" messages if any
    const noDataMsgId = `no-data-${plantId}`;
    const existingNoDataMsg = chartContainer.querySelector(`#${noDataMsgId}`);
    if (existingNoDataMsg) {
        existingNoDataMsg.remove();
    }

    // Handle case with no measurements
    if (!measurements || measurements.length === 0) {
        console.log(`No measurement data for plant ${plantId}. Clearing charts.`);
        
        // Destroy existing chart instances if they exist
        if (plantCharts[plantId]) {
            plantCharts[plantId].humidityChart?.destroy();
            plantCharts[plantId].temperatureChart?.destroy();
        }
        plantCharts[plantId] = { humidityChart: null, temperatureChart: null };

        // Display a "No data" message
        const noDataMessage = document.createElement('p');
        noDataMessage.id = noDataMsgId;
        noDataMessage.textContent = 'No measurement data available to display charts.';
        noDataMessage.style.textAlign = 'center';
        chartContainer.insertBefore(noDataMessage, humidityCanvas);

        humidityCanvas.style.display = 'none';
        temperatureCanvas.style.display = 'none';
        return;
    } else {
        // Ensure canvases are visible if we have data
        humidityCanvas.style.display = 'block';
        temperatureCanvas.style.display = 'block';
    }

    // Prepare data for charts
    const labels = measurements.map(m => formatChartLabel(m.ts));
    const humidityData = measurements.map(m => m.moisture);
    const temperatureData = measurements.map(m => m.temperature);

    // Check if charts already exist for this plant
    const existingCharts = plantCharts[plantId];

    // Render or Update Humidity Chart
    if (existingCharts?.humidityChart) {
        // Update existing chart
        existingCharts.humidityChart.data.labels = labels;
        existingCharts.humidityChart.data.datasets[0].data = humidityData;
        existingCharts.humidityChart.update();
        console.log(`Updated humidity chart for plant ${plantId}`);
    } else {
        // Create new chart
        const humidityChart = new Chart(humidityCanvas.getContext('2d'), {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Moisture (%)',
                    data: humidityData,
                    borderColor: 'rgb(54, 162, 235)',
                    backgroundColor: 'rgba(54, 162, 235, 0.1)',
                    tension: 0.1,
                    pointRadius: 2,
                    fill: true,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: true, position: 'top' } },
                scales: {
                    y: { beginAtZero: false, suggestedMax: 100, title: { display: true, text: 'Moisture (%)' } },
                    x: { title: { display: true, text: 'Time' } }
                }
            }
        });
        if (!plantCharts[plantId]) plantCharts[plantId] = {};
        plantCharts[plantId].humidityChart = humidityChart;
    }

    // Render or Update Temperature Chart
    if (existingCharts?.temperatureChart) {
        // Update existing chart
        existingCharts.temperatureChart.data.labels = labels;
        existingCharts.temperatureChart.data.datasets[0].data = temperatureData;
        existingCharts.temperatureChart.update();
    } else {
        // Create new chart
        const temperatureChart = new Chart(temperatureCanvas.getContext('2d'), {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Temperature (°C)',
                    data: temperatureData,
                    borderColor: 'rgb(255, 99, 132)',
                    backgroundColor: 'rgba(255, 99, 132, 0.1)',
                    tension: 0.1,
                    pointRadius: 2,
                    fill: true,
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: { legend: { display: true, position: 'top' } },
                scales: {
                    y: { beginAtZero: false, title: { display: true, text: 'Temperature (°C)' } },
                    x: { title: { display: true, text: 'Time' } }
                }
            }
        });
        if (!plantCharts[plantId]) plantCharts[plantId] = {};
        plantCharts[plantId].temperatureChart = temperatureChart;
    }
}

async function renderPlants(plants) {
    plantListDiv.innerHTML = ''; // Clear previous list or loading message
    if (plants.length === 0) {
        plantListDiv.innerHTML = '<p>No plants found. Add one below!</p>';
        return;
    }

    // Clear chart instances for plants that might have been removed
    const currentPlantIds = new Set(plants.map(p => p.id));
    Object.keys(plantCharts).forEach(plantId => {
        if (!currentPlantIds.has(parseInt(plantId))) {
            plantCharts[plantId].humidityChart?.destroy();
            plantCharts[plantId].temperatureChart?.destroy();
            delete plantCharts[plantId];
        }
    });

    for (const plant of plants) {
        const plantCard = document.createElement('div');
        plantCard.className = 'plant-card';
        plantCard.id = `plant-card-${plant.id}`;

        // Create the plant card with toggle button and chart container
        plantCard.innerHTML = `
            <div class="plant-info" data-plant-id="${plant.id}">
                <h4>${plant.name} (ID: ${plant.id})</h4>
                <div class="plant-measurements" id="measurements-${plant.id}">Loading measurements...</div>
            </div>
            <button class="toggle-chart-button" data-plant-id="${plant.id}">Show Charts</button>
            <div class="chart-container hidden" id="chart-container-${plant.id}">
                <p><strong>Measurement History:</strong></p>
                <div class="chart-wrapper">
                    <canvas id="humidity-chart-${plant.id}"></canvas>
                </div>
                <div class="chart-wrapper">
                    <canvas id="temperature-chart-${plant.id}"></canvas>
                </div>
            </div>
            <button class="water-button" data-plant-id="${plant.id}">Manual Water (5s)</button>
            <button class="delete-button" data-plant-id="${plant.id}">Delete Plant</button>
        `;
        plantListDiv.appendChild(plantCard);

        // Add event listener for the water button
        const waterButton = plantCard.querySelector(`.water-button[data-plant-id="${plant.id}"]`);
        waterButton.addEventListener('click', () => handleManualWater(plant.id));

        // Add event listener for the delete button
        const deleteButton = plantCard.querySelector(`.delete-button[data-plant-id="${plant.id}"]`);
        deleteButton.addEventListener('click', () => handleDeletePlant(plant.id, plant.name));

        // Add event listener for the toggle chart button
        const toggleChartButton = plantCard.querySelector(`.toggle-chart-button[data-plant-id="${plant.id}"]`);
        toggleChartButton.addEventListener('click', async (e) => {
            const button = e.target;
            const chartContainer = document.getElementById(`chart-container-${plant.id}`);
            const isHidden = chartContainer.classList.toggle('hidden');
            
            // Update button text
            button.textContent = isHidden ? 'Show Charts' : 'Hide Charts';
            
            // If we just revealed the container, load/update the charts
            if (!isHidden) {
                console.log(`Revealing charts for plant ${plant.id}`);
                const measurements = await fetchMeasurements(plant.id);
                renderCharts(plant.id, measurements);
            }
        });

        // Fetch and display latest measurements
        const measurements = await fetchMeasurements(plant.id);
        const measurementsDiv = document.getElementById(`measurements-${plant.id}`);
        if (measurements.length > 0) {
            const latest = measurements[measurements.length - 1]; // Get the most recent (now last after reverse)
            measurementsDiv.innerHTML = `
                Latest Reading (${new Date(latest.ts * 1000).toLocaleString()}):<br>
                Moisture: ${latest.moisture}% | Temp: ${latest.temperature}°C
            `;
        } else {
            measurementsDiv.innerHTML = 'No measurements found.';
        }
    }
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

async function handleDeletePlant(plantId, plantName) {
    // Confirm deletion with user
    const confirmed = confirm(`Are you sure you want to delete "${plantName}"?\n\nThis will permanently remove the plant and all its measurement data.`);
    
    if (!confirmed) {
        return;
    }

    console.log(`Requesting deletion for plant ${plantId}...`);
    const deleteButton = document.querySelector(`.delete-button[data-plant-id="${plantId}"]`);
    deleteButton.disabled = true;
    deleteButton.textContent = 'Deleting...';

    const result = await apiCall(`/api/plants/${plantId}`, 'DELETE', null, true);

    if (result && !result.error) {
        console.log(`Plant ${plantId} deleted successfully`);
        
        // Clean up chart instances for this plant
        if (plantCharts[plantId]) {
            plantCharts[plantId].humidityChart?.destroy();
            plantCharts[plantId].temperatureChart?.destroy();
            delete plantCharts[plantId];
        }
        
        // Remove the plant card from DOM
        const plantCard = document.getElementById(`plant-card-${plantId}`);
        if (plantCard) {
            plantCard.remove();
        }
        
        // Check if plant list is now empty
        if (plantListDiv.children.length === 0) {
            plantListDiv.innerHTML = '<p>No plants found. Add one below!</p>';
        }
    } else {
        console.error(`Failed to delete plant ${plantId}`);
        alert(`Failed to delete plant "${plantName}". Please try again.`);
        
        // Re-enable button on error
        deleteButton.disabled = false;
        deleteButton.textContent = 'Delete Plant';
    }
}

async function handleAddPlant(event) {
    event.preventDefault();
    clearErrors();
    const name = document.getElementById('plant-name').value;
    const plantIdInput = document.getElementById('plant-id');
    const plantId = plantIdInput.value ? parseInt(plantIdInput.value) : null;
    
    const payload = {
        name: name
    };
    
    // Dodaj plant_id do żądania tylko jeśli zostało podane
    if (plantId) {
        payload.plant_id = plantId;
    }

    const result = await apiCall('/api/plants', 'POST', payload, true);

    if (result && !result.error) {
        console.log('Plant added:', result);
        addPlantForm.reset();
        fetchPlants(); // Refresh the plant list
    } else {
        showAddPlantError(result?.data?.error || 'Failed to add plant.');
    }
}

// modified setupAddPlantForm to include plant_id input
function setupAddPlantForm() {
    const addPlantForm = document.getElementById('add-plant-form');
    
    addPlantForm.innerHTML = `
        <h3>Add New Plant</h3>
        <div class="form-group">
            <label for="plant-name">Plant Name:</label>
            <input type="text" id="plant-name" name="plant-name" required>
        </div>
        <div class="form-group">
            <label for="plant-id">Plant ID (optional):</label>
            <input type="number" id="plant-id" name="plant-id" min="1">
            <small>Leave blank for auto-generated ID. Set this only if you need to match a specific device.</small>
        </div>
        <button type="submit" class="submit-button" style="margin-top: 10px;">Add Plant</button>
        <p id="add-plant-error" class="error-message"></p>
    `;
}

// --- Initialization ---

function init() {
    loginForm.addEventListener('submit', handleLogin);
    registerForm.addEventListener('submit', handleRegister);
    addPlantForm.addEventListener('submit', handleAddPlant);
    logoutButton.addEventListener('click', logout);
    
    // Dodaj tę linię aby utworzyć formularz z polem plant_id
    setupAddPlantForm();

    const token = getToken();
    if (token) {
        // Check for cached email first
        const cachedEmail = getUserEmail();
        if (cachedEmail) {
            userEmailDisplay.textContent = cachedEmail;
        } else {
            userEmailDisplay.textContent = "Loading..."; // Placeholder
        }
        
        // First, try to get the user details to verify token is valid
        fetchUserDetails().then(user => {
            if (user) {
                console.log("Token valid, user details fetched successfully");
                showPlantSection();
            } else {
                // If we couldn't fetch user details, try plants as fallback
                console.log("Failed to fetch user details, trying plants as fallback");
                apiCall('/api/plants', 'GET', null, true).then(plants => {
                    if (plants && !plants.error) {
                        showPlantSection();
                    } else {
                        console.log("Token invalid or requests failed, showing auth");
                        logout(); // Clear invalid token and show login
                    }
                });
            }
        });
    } else {
        console.log("No token found, showing auth section.");
        showAuthSection();
    }
}

// Run initialization when the DOM is ready
document.addEventListener('DOMContentLoaded', init);
