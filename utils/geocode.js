const axios = require('axios');

// Helper function to calculate distance between two coordinates in kilometers (Haversine formula)
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Radius of the Earth in km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a = 
    Math.sin(dLat/2) * Math.sin(dLat/2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * 
    Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  const distance = R * c;
  return distance;
}

function toRad(degrees) {
  return degrees * (Math.PI / 180);
}

async function geocodeAddress(address, attempt = 1, maxAttempts = 3) {
  if (!address || (typeof address !== 'string' && typeof address !== 'object')) {
    console.error('Invalid address format:', address);
    return null;
  }

  // If address is an object, convert it to a string
  const query = typeof address === 'string' 
    ? address.trim() 
    : buildFullAddress(address);
  
  if (!query) {
    console.error('Empty address after formatting');
    return null;
  }

  try {
    // Try different address formats if first attempt fails
    let formattedQuery = query;
    if (attempt > 1) {
      // Remove less important parts of the address for broader matching
      const parts = query.split(',').map(p => p.trim());
      // Try with fewer parts on subsequent attempts
      formattedQuery = parts.slice(0, -1 * (attempt - 1)).join(', ');
      // Trying simplified address format
    }

    const response = await axios.get('https://nominatim.openstreetmap.org/search', {
      params: {
        q: formattedQuery,
        format: 'json',
        addressdetails: 1,
        limit: 1,
        countrycodes: 'pk', // Prioritize Pakistan addresses
        'accept-language': 'en' // Prefer English results
      },
      headers: {
        'User-Agent': 'AgriBazaar/1.0 (abdullahabdulhannan.ab@gmail.com)'
      },
      timeout: 10000 // 10 second timeout
    });

    const data = response.data;
    
    if (data && data[0]) {
      const result = {
        latitude: parseFloat(data[0].lat),
        longitude: parseFloat(data[0].lon),
        displayName: data[0].display_name,
        address: data[0].address || {}
      };
      return result;
    }
    
    // If no results and we have more attempts, try again with a simpler address
    if (attempt < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 1000)); // 1 second delay between retries
      return geocodeAddress(address, attempt + 1, maxAttempts);
    }
    
    console.warn('No geocoding results after all attempts');
    return null;
    
  } catch (error) {
    console.error(`Geocoding error (attempt ${attempt}):`, error.message);
    
    // If we have more attempts, try again after a short delay
    if (attempt < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 2000)); // 2 second delay
      return geocodeAddress(address, attempt + 1, maxAttempts);
    }
    
    return null;
  }
}

function buildFullAddress(addressLike) {
  if (!addressLike) return '';
  if (typeof addressLike === 'string') return addressLike.trim();
  
  const parts = [];
  
  // Try to build address from individual components first
  // const street = addressLike.street || addressLike.addressLine1 || '';
  // const addressLine2 = addressLike.addressLine2 || '';
  const area = addressLike.area || addressLike.district || addressLike.suburb || '';
  const city = addressLike.city || addressLike.town || addressLike.village || '';
  const state = addressLike.state || addressLike.county || '';
  const postalCode = addressLike.postalCode || addressLike.postcode || '';
  const country = addressLike.country || 'Pakistan';
  
  // Build address in a structured way
  // if (street) parts.push(street);
  // if (addressLine2) parts.push(addressLine2);
  if (area) parts.push(area);
  if (city) parts.push(city);
  if (state) parts.push(state);
  if (postalCode) parts.push(postalCode);
  if (country && country.toLowerCase() !== 'pakistan') {
    parts.push(country);
  }
  
  // If we have no parts, try to use displayName or formatted address if available
  if (parts.length === 0) {
    return addressLike.display_name || 
           addressLike.displayName || 
           addressLike.formatted || 
           JSON.stringify(addressLike);
  }
  
  return parts.join(', ');
}

module.exports = {
  geocodeAddress,
  buildFullAddress,
  calculateDistance
};