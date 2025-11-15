import React, { useState, useEffect, useMemo } from 'react';
import { initializeApp } from 'firebase/app';
import { getAuth, signInAnonymously, signInWithCustomToken, onAuthStateChanged, signOut } from 'firebase/auth';
import { getFirestore, doc, setDoc, getDoc, addDoc, collection, query, where, onSnapshot, serverTimestamp, updateDoc, deleteDoc, runTransaction } from 'firebase/firestore';
import { Home, Search, Heart, User, PlusCircle, LogOut, MessageSquare, Trash2, Shield, Settings, DollarSign } from 'lucide-react';

// --- Global Variables (Mandatory for Canvas Environment) ---
const appId = typeof __app_id !== 'undefined' ? __app_id : 'default-app-id';
const firebaseConfig = typeof __firebase_config !== 'undefined' ? JSON.parse(__firebase_config) : {};
const initialAuthToken = typeof __initial_auth_token !== 'undefined' ? __initial_auth_token : null;

// --- App Constants ---
const PRIMARY_COLOR = '#002f34'; // Dark Teal/Blue
const ACCENT_COLOR = '#ffce32';  // Bright Yellow/Orange
const CATEGORIES = ['Cars', 'Motorcycles', 'Mobile Phones', 'Apartments', 'Electronics', 'Jobs', 'Services', 'Books'];

// --- Helper Functions ---
const formatPrice = (price) => `Rs ${price.toLocaleString('en-IN')}`;

/**
 * Custom hook to handle Firebase initialization and authentication.
 */
const useFirebase = () => {
    const [db, setDb] = useState(null);
    const [auth, setAuth] = useState(null);
    const [userId, setUserId] = useState(null);
    const [isAuthReady, setIsAuthReady] = useState(false);

    useEffect(() => {
        if (!Object.keys(firebaseConfig).length) {
            console.error("Firebase config is missing.");
            return;
        }

        const app = initializeApp(firebaseConfig);
        const authInstance = getAuth(app);
        const dbInstance = getFirestore(app);

        setAuth(authInstance);
        setDb(dbInstance);

        const unsubscribe = onAuthStateChanged(authInstance, (user) => {
            if (user) {
                setUserId(user.uid);
            } else {
                setUserId(null);
                // Attempt silent sign-in if initial token is available
                if (initialAuthToken) {
                    signInWithCustomToken(authInstance, initialAuthToken).catch(e => {
                        console.error("Custom token sign-in failed, signing in anonymously.", e);
                        signInAnonymously(authInstance).catch(err => console.error("Anonymous sign-in failed:", err));
                    });
                } else {
                    signInAnonymously(authInstance).catch(err => console.error("Anonymous sign-in failed:", err));
                }
            }
            setIsAuthReady(true);
        });

        return () => unsubscribe();
    }, []);

    return { db, auth, userId, isAuthReady };
};

// --- Firebase Data Service Hooks ---

/**
 * Fetches the list of all ads based on query criteria and user favorites.
 */
const useAds = (db, isAuthReady, userId, queryState) => {
    const [ads, setAds] = useState([]);
    const [favorites, setFavorites] = useState({});

    // 1. Fetch user favorites
    useEffect(() => {
        if (!db || !isAuthReady || !userId) return;

        const favoritesRef = doc(db, `artifacts/${appId}/users/${userId}/profile`, 'favorites');
        const unsubscribe = onSnapshot(favoritesRef, (docSnap) => {
            if (docSnap.exists()) {
                setFavorites(docSnap.data().adIds || {});
            } else {
                setFavorites({});
            }
        }, (error) => console.error("Error fetching favorites:", error));

        return () => unsubscribe();
    }, [db, isAuthReady, userId]);

    // 2. Fetch ads based on filters
    useEffect(() => {
        // FIX: Added check for userId here to ensure full authentication context is available
        if (!db || !isAuthReady || !userId) return; 

        const adsCollectionRef = collection(db, `artifacts/${appId}/public/data/ads`);
        let q = query(adsCollectionRef);

        const { search, category, minPrice, maxPrice } = queryState;

        // Note: Complex queries (like range + text search) are not easily supported without composite indexes.
        // We handle simple filters here and client-side filtering for search text.

        if (category && category !== 'All Categories') {
            q = query(q, where('category', '==', category));
        }

        if (minPrice) {
            // Note: Firestore does not support multiple range filters on different fields,
            // so we'll apply maxPrice filtering client-side if minPrice is used.
            q = query(q, where('price', '>=', parseInt(minPrice)));
        }

        const unsubscribe = onSnapshot(q, (snapshot) => {
            const fetchedAds = snapshot.docs.map(doc => ({
                id: doc.id,
                ...doc.data()
            }));

            // Client-side filtering for search text and max price (if min price isn't the primary query)
            let filteredAds = fetchedAds.filter(ad => {
                const searchMatch = !search || 
                    ad.title.toLowerCase().includes(search.toLowerCase()) || 
                    ad.description.toLowerCase().includes(search.toLowerCase()) ||
                    ad.location.toLowerCase().includes(search.toLowerCase());
                
                const maxPriceMatch = !maxPrice || ad.price <= parseInt(maxPrice);
                
                return searchMatch && maxPriceMatch;
            }).sort((a, b) => b.timestamp.seconds - a.timestamp.seconds); // Sort by newest

            setAds(filteredAds);
        }, (error) => console.error("Error fetching ads:", error));

        return () => unsubscribe();
    }, [db, isAuthReady, userId, queryState.category, queryState.minPrice, queryState.maxPrice, queryState.search]);

    // 3. Merge ads with favorite status
    const adsWithFavorites = useMemo(() => {
        return ads.map(ad => ({
            ...ad,
            isSaved: favorites[ad.id] === true
        }));
    }, [ads, favorites]);

    return adsWithFavorites;
};


// --- Firestore Utility Functions (CRUD) ---

const toggleFavorite = async (db, userId, adId) => {
    if (!db || !userId) return;

    const favoritesRef = doc(db, `artifacts/${appId}/users/${userId}/profile`, 'favorites');

    await runTransaction(db, async (transaction) => {
        const docSnap = await transaction.get(favoritesRef);
        let currentFavorites = docSnap.exists() ? (docSnap.data().adIds || {}) : {};

        if (currentFavorites[adId]) {
            // Unsave
            delete currentFavorites[adId];
        } else {
            // Save
            currentFavorites[adId] = true;
        }

        transaction.set(favoritesRef, { adIds: currentFavorites });
    });
};

const postAd = async (db, userId, adData) => {
    if (!db || !userId) return;
    const adsCollectionRef = collection(db, `artifacts/${appId}/public/data/ads`);

    await addDoc(adsCollectionRef, {
        ...adData,
        userId: userId,
        timestamp: serverTimestamp(),
        location: adData.location || 'Unknown'
    });
};

const deleteAd = async (db, adId) => {
    if (!db) return;
    const adRef = doc(db, `artifacts/${appId}/public/data/ads`, adId);
    await deleteDoc(adRef);
};


// --- UI Components ---

const Button = ({ children, primary, className = '', onClick, type = 'button' }) => {
    // FIX: Refactored component to use standard Tailwind classes and React 'style' prop
    // to apply custom colors, fixing the non-boolean attribute warning.
    const baseClasses = "px-4 py-2 font-semibold rounded-md transition-colors";
        
    // Define classes and styles based on primary prop
    const primaryClasses = "hover:bg-yellow-400";
    const primaryStyles = { backgroundColor: ACCENT_COLOR, color: PRIMARY_COLOR };
    
    const secondaryClasses = "bg-white hover:bg-gray-100 border-2";
    const secondaryStyles = { borderColor: PRIMARY_COLOR, color: PRIMARY_COLOR };

    return (
        <button
            type={type}
            onClick={onClick}
            className={`${baseClasses} ${className} ${primary ? primaryClasses : secondaryClasses}`}
            style={primary ? primaryStyles : secondaryStyles}
        >
            {children}
        </button>
    );
};

const IconButton = ({ children, onClick, saved, className = '' }) => (
    <button
        onClick={onClick}
        className={`p-2 rounded-full shadow-lg transition-all 
            ${saved 
                ? 'bg-white text-red-500 hover:scale-110' 
                : 'bg-white text-gray-500 hover:text-red-500'
            } ${className}`}
        style={{ color: saved ? ACCENT_COLOR : PRIMARY_COLOR }}
    >
        {children}
    </button>
);

const AdCard = ({ ad, db, userId, onAdClick }) => {
    const handleFavoriteClick = (e) => {
        e.stopPropagation();
        e.preventDefault();
        if (db && userId) {
            toggleFavorite(db, userId, ad.id);
        }
    };

    return (
        <div
            className="w-full bg-white border border-gray-200 rounded-lg overflow-hidden shadow-sm hover:shadow-xl transition-shadow duration-300 cursor-pointer"
            onClick={() => onAdClick(ad)}
        >
            <div className="relative h-40 overflow-hidden bg-gray-100">
                <img
                    src={ad.imageUrl}
                    alt={ad.title}
                    className="w-full h-full object-cover transition-transform duration-500 hover:scale-105"
                    onError={(e) => {
                        e.target.onerror = null;
                        e.target.src = `https://placehold.co/600x400/${PRIMARY_COLOR.replace('#', '')}/ffffff?text=OIX+Ad`;
                    }}
                />
                <div className="absolute top-2 right-2">
                    <IconButton onClick={handleFavoriteClick} saved={ad.isSaved}>
                        <Heart size={20} fill={ad.isSaved ? ACCENT_COLOR : 'none'} stroke={ad.isSaved ? ACCENT_COLOR : 'white'} style={{ filter: ad.isSaved ? 'drop-shadow(0 0 1px #000)' : 'none' }} />
                    </IconButton>
                </div>
            </div>
            <div className="p-3">
                <div className="text-xl font-bold text-gray-900" style={{ color: PRIMARY_COLOR }}>
                    {formatPrice(ad.price)}
                </div>
                <h3 className="text-sm h-10 overflow-hidden font-medium text-gray-700 mt-1 mb-2">
                    {ad.title}
                </h3>
                <div className="flex justify-between text-xs text-gray-500 pt-2 border-t border-gray-100">
                    <span>{ad.location}</span>
                    <span>{ad.category}</span>
                </div>
            </div>
        </div>
    );
};

const Header = ({ setPage, userId, auth, setQueryState, currentQuery }) => {
    const [search, setSearch] = useState(currentQuery.search || '');

    const handleSearchSubmit = (e) => {
        e.preventDefault();
        setQueryState(prev => ({ ...prev, search }));
        setPage('home');
    };

    const handleLogout = () => {
        signOut(auth).catch(e => console.error("Logout failed:", e));
    };

    const AdCountDisplay = () => (
        <div className="flex items-center text-sm font-medium text-gray-600">
            <User size={16} className="mr-1" />
            <span className="truncate max-w-28 sm:max-w-full" title={userId}>
                User ID: {userId.substring(0, 8)}...
            </span>
        </div>
    );

    return (
        <header className="sticky top-0 z-20 shadow-md" style={{ backgroundColor: 'white' }}>
            <div className="container mx-auto px-4 py-3 flex items-center justify-between">
                <div
                    className="text-3xl font-extrabold cursor-pointer tracking-tighter"
                    style={{ color: PRIMARY_COLOR }}
                    onClick={() => {
                        setPage('home');
                        setQueryState({}); // Reset filters on logo click
                    }}
                >
                    OIX
                </div>

                <form onSubmit={handleSearchSubmit} className="hidden md:flex w-1/2 mx-4 border-2 rounded-lg overflow-hidden border-gray-300 focus-within:border-gray-500 transition-all">
                    <input
                        type="text"
                        placeholder="Find Cars, Mobiles, and more..."
                        className="flex-grow p-2 outline-none text-gray-700"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                    <button type="submit" className="px-4" style={{ backgroundColor: ACCENT_COLOR }}>
                        <Search size={20} style={{ color: PRIMARY_COLOR }} />
                    </button>
                </form>

                <div className="flex items-center space-x-4">
                    {userId && <AdCountDisplay />}
                    {/* FIX: Corrected malformed className usage */}
                    <Button 
                        onClick={() => setPage('post')} 
                        primary={false} 
                        className="border-4" 
                        style={{ borderColor: ACCENT_COLOR }} // Set accent color border via style
                    >
                        <PlusCircle size={18} className="inline-block mr-1" /> SELL
                    </Button>
                    {userId && (
                        <IconButton onClick={handleLogout} className="text-gray-600 hover:bg-gray-100 p-2">
                            <LogOut size={20} />
                        </IconButton>
                    )}
                </div>
            </div>
        </header>
    );
};

const Sidebar = ({ setQueryState, currentQuery }) => {
    const [minPrice, setMinPrice] = useState(currentQuery.minPrice || '');
    const [maxPrice, setMaxPrice] = useState(currentQuery.maxPrice || '');
    const [category, setCategory] = useState(currentQuery.category || 'All Categories');

    const handleFilterSubmit = (e) => {
        e.preventDefault();
        setQueryState({ 
            search: currentQuery.search || '',
            category, 
            minPrice, 
            maxPrice 
        });
    };

    return (
        <div className="w-full md:w-64 p-4 rounded-lg bg-white shadow-lg border border-gray-100">
            <h3 className="text-lg font-bold pb-2 mb-4 border-b border-gray-200" style={{ color: PRIMARY_COLOR }}>Filters</h3>
            <form onSubmit={handleFilterSubmit}>
                
                <div className="mb-4">
                    <label className="block text-sm font-medium mb-1 text-gray-700">Category</label>
                    <select
                        value={category}
                        onChange={(e) => setCategory(e.target.value)}
                        className="w-full p-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500"
                    >
                        <option value="All Categories">All Categories</option>
                        {CATEGORIES.map(cat => (
                            <option key={cat} value={cat}>{cat}</option>
                        ))}
                    </select>
                </div>

                <div className="mb-4">
                    <label className="block text-sm font-medium mb-1 text-gray-700">Price Range (PKR)</label>
                    <input
                        type="number"
                        placeholder="Min Price"
                        value={minPrice}
                        onChange={(e) => setMinPrice(e.target.value)}
                        className="w-full p-2 border border-gray-300 rounded-md mb-2 focus:ring-1 focus:ring-blue-500"
                    />
                    <input
                        type="number"
                        placeholder="Max Price"
                        value={maxPrice}
                        onChange={(e) => setMaxPrice(e.target.value)}
                        className="w-full p-2 border border-gray-300 rounded-md focus:ring-1 focus:ring-blue-500"
                    />
                </div>

                <Button type="submit" primary={true} className="w-full" style={{ backgroundColor: PRIMARY_COLOR, color: 'white' }}>
                    Apply Filters
                </Button>
            </form>
        </div>
    );
};

const AdDetails = ({ ad, setPage, db, userId }) => {
    if (!ad) return null;

    const handleToggleFavorite = () => {
        if (db && userId) {
            toggleFavorite(db, userId, ad.id);
        }
    };

    const handleDelete = () => {
        // FIX: Replaced window.confirm() with console message as required by rules
        console.warn('Confirmation dialog omitted. Ad deletion is assumed to be confirmed by the user.');
        deleteAd(db, ad.id);
        setPage('home');
    };

    return (
        <div className="container mx-auto p-4 md:p-8">
            <div className="max-w-4xl mx-auto bg-white rounded-xl shadow-2xl overflow-hidden">
                <div className="p-6 md:flex">
                    
                    {/* Left Column: Image & Description */}
                    <div className="md:w-2/3 md:pr-6">
                        <div className="h-96 w-full bg-gray-100 rounded-lg overflow-hidden mb-6">
                            <img
                                src={ad.imageUrl}
                                alt={ad.title}
                                className="w-full h-full object-contain"
                                onError={(e) => { e.target.onerror = null; e.target.src = `https://placehold.co/600x400/${PRIMARY_COLOR.replace('#', '')}/ffffff?text=OIX+Ad`; }}
                            />
                        </div>
                        
                        <div className="p-4 border border-gray-200 rounded-lg shadow-inner">
                            <h3 className="text-2xl font-bold mb-3" style={{ color: PRIMARY_COLOR }}>Description</h3>
                            <p className="text-gray-700 leading-relaxed whitespace-pre-wrap">{ad.description}</p>
                        </div>
                    </div>

                    {/* Right Column: Price & Seller Info */}
                    <div className="md:w-1/3 mt-6 md:mt-0 space-y-6">
                        
                        {/* Price Card */}
                        <div className="p-6 border-2 rounded-lg" style={{ borderColor: PRIMARY_COLOR }}>
                            <div className="text-4xl font-extrabold mb-1" style={{ color: PRIMARY_COLOR }}>
                                {formatPrice(ad.price)}
                            </div>
                            <h2 className="text-xl font-semibold text-gray-800">{ad.title}</h2>
                            <div className="text-sm text-gray-500 mt-2 flex justify-between">
                                <span>{ad.location}</span>
                                <span>{new Date(ad.timestamp?.seconds * 1000).toLocaleDateString()}</span>
                            </div>
                        </div>

                        {/* Seller Card (Mock Messaging) */}
                        <div className="p-6 border border-gray-200 rounded-lg shadow-md text-center">
                            <h3 className="text-lg font-bold mb-3" style={{ color: PRIMARY_COLOR }}>Contact Seller</h3>
                            <p className="text-xs text-gray-500 mb-4">Seller ID: {ad.userId.substring(0, 10)}...</p>
                            
                            <Button primary={true} className="w-full mb-3 flex items-center justify-center">
                                <MessageSquare size={20} className="mr-2" /> Chat with Seller
                            </Button>
                            <Button primary={false} className="w-full flex items-center justify-center">
                                <DollarSign size={20} className="mr-2" /> Make an Offer
                            </Button>
                        </div>
                        
                        {/* Actions */}
                        <div className="p-4 bg-gray-50 rounded-lg space-y-3">
                            <Button 
                                primary={ad.isSaved} 
                                className="w-full flex items-center justify-center"
                                onClick={handleToggleFavorite}
                            >
                                <Heart size={18} className="mr-2" fill={ad.isSaved ? PRIMARY_COLOR : 'none'} stroke={ad.isSaved ? PRIMARY_COLOR : PRIMARY_COLOR} /> 
                                {ad.isSaved ? 'UNSAVE AD' : 'SAVE AD'}
                            </Button>
                            
                            {/* Admin/Owner Actions */}
                            {userId === ad.userId && (
                                <Button 
                                    primary={false} 
                                    className="w-full flex items-center justify-center border-red-500 text-red-500 hover:bg-red-50"
                                    onClick={handleDelete}
                                >
                                    <Trash2 size={18} className="mr-2" /> DELETE AD
                                </Button>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

const PostAdForm = ({ setPage, db, userId }) => {
    const [formData, setFormData] = useState({
        title: '', description: '', price: '', category: CATEGORIES[0], location: '', imageUrl: '',
    });
    const [loading, setLoading] = useState(false);
    const [message, setMessage] = useState('');

    const handleChange = (e) => {
        const { name, value } = e.target;
        setFormData(prev => ({ ...prev, [name]: value }));
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        if (!db || !userId) {
            setMessage('Error: You must be logged in to post an ad.');
            return;
        }

        setLoading(true);
        try {
            await postAd(db, userId, {
                ...formData,
                price: parseFloat(formData.price),
                imageUrl: formData.imageUrl || `https://placehold.co/600x400/${PRIMARY_COLOR.replace('#', '')}/ffffff?text=OIX+Ad`
            });
            setMessage('Ad posted successfully! Redirecting...');
            setTimeout(() => setPage('home'), 1500);
        } catch (error) {
            console.error("Error posting ad:", error);
            setMessage('Failed to post ad. See console for details.');
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="container mx-auto p-4">
            <div className="max-w-2xl mx-auto bg-white p-8 rounded-xl shadow-2xl border border-gray-100">
                <h2 className="text-3xl font-bold mb-6 text-center" style={{ color: PRIMARY_COLOR }}>
                    Post Your Ad
                </h2>
                <form onSubmit={handleSubmit}>
                    
                    {['title', 'location'].map(field => (
                        <div className="mb-4" key={field}>
                            <label className="block text-sm font-medium mb-1 text-gray-700 capitalize">{field}</label>
                            <input
                                type="text"
                                name={field}
                                value={formData[field]}
                                onChange={handleChange}
                                required
                                className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                            />
                        </div>
                    ))}
                    
                    <div className="mb-4">
                        <label className="block text-sm font-medium mb-1 text-gray-700">Category</label>
                        <select
                            name="category"
                            value={formData.category}
                            onChange={handleChange}
                            required
                            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                        >
                            {CATEGORIES.map(cat => (
                                <option key={cat} value={cat}>{cat}</option>
                            ))}
                        </select>
                    </div>

                    <div className="mb-4">
                        <label className="block text-sm font-medium mb-1 text-gray-700">Price (PKR)</label>
                        <input
                            type="number"
                            name="price"
                            value={formData.price}
                            onChange={handleChange}
                            required
                            min="0"
                            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                        />
                    </div>

                    <div className="mb-4">
                        <label className="block text-sm font-medium mb-1 text-gray-700">Description</label>
                        <textarea
                            name="description"
                            value={formData.description}
                            onChange={handleChange}
                            required
                            rows="5"
                            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                        />
                    </div>
                    
                    <div className="mb-6">
                        <label className="block text-sm font-medium mb-1 text-gray-700">Image URL (Optional)</label>
                        <input
                            type="url"
                            name="imageUrl"
                            value={formData.imageUrl}
                            onChange={handleChange}
                            className="w-full p-3 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                        />
                        <small className="text-gray-500">A placeholder image will be used if blank.</small>
                    </div>

                    <Button type="submit" primary={true} className="w-full text-lg" disabled={loading}>
                        {loading ? 'Posting...' : 'POST AD'}
                    </Button>
                    {message && <p className="mt-4 text-center text-green-600 font-semibold">{message}</p>}
                </form>
            </div>
        </div>
    );
};

const Dashboard = ({ ads, setPage, setSelectedAd, userId }) => {
    const userAds = ads.filter(ad => ad.userId === userId);
    const favoriteAds = ads.filter(ad => ad.isSaved);
    
    // Simple state to toggle between My Ads and Favorites
    const [activeTab, setActiveTab] = useState('myads'); 
    
    const displayAds = activeTab === 'myads' ? userAds : favoriteAds;
    const isOwnerTab = activeTab === 'myads';

    return (
        <div className="container mx-auto p-4 md:p-8">
            <h2 className="text-3xl font-bold mb-6" style={{ color: PRIMARY_COLOR }}>My OIX Dashboard</h2>
            <div className="mb-6 flex space-x-4 border-b border-gray-200">
                <button
                    onClick={() => setActiveTab('myads')}
                    className={`pb-2 px-3 font-semibold text-lg transition-colors ${isOwnerTab ? 'border-b-4' : 'text-gray-500 hover:text-gray-700'}`}
                    style={{ borderColor: isOwnerTab ? PRIMARY_COLOR : 'transparent', color: isOwnerTab ? PRIMARY_COLOR : undefined }}
                >
                    My Ads ({userAds.length})
                </button>
                <button
                    onClick={() => setActiveTab('favorites')}
                    className={`pb-2 px-3 font-semibold text-lg transition-colors ${!isOwnerTab ? 'border-b-4' : 'text-gray-500 hover:text-gray-700'}`}
                    style={{ borderColor: !isOwnerTab ? PRIMARY_COLOR : 'transparent', color: !isOwnerTab ? PRIMARY_COLOR : undefined }}
                >
                    Favorites ({favoriteAds.length})
                </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
                {displayAds.length > 0 ? (
                    displayAds.map(ad => (
                        <div key={ad.id} onClick={() => { setSelectedAd(ad); setPage('details'); }}>
                             <AdCard 
                                ad={ad} 
                                // Omit db/userId props as they aren't needed for Dashboard display
                                onAdClick={() => { setSelectedAd(ad); setPage('details'); }} 
                            />
                            {/* Add a simple indicator for owner ads */}
                            {isOwnerTab && (
                                <div className="text-center text-sm font-medium mt-1 text-green-600">
                                    <Shield size={16} className="inline-block mr-1" /> Owned
                                </div>
                            )}
                        </div>
                    ))
                ) : (
                    <p className="text-gray-500 col-span-4 p-10 text-center bg-white rounded-lg">
                        {isOwnerTab ? "You have not posted any ads yet." : "You have no saved favorite ads."}
                    </p>
                )}
            </div>
        </div>
    );
};

// --- Main Application Component ---

const App = () => {
    const { db, auth, userId, isAuthReady } = useFirebase();
    const [page, setPage] = useState('home');
    const [selectedAd, setSelectedAd] = useState(null);
    const [queryState, setQueryState] = useState({}); // Stores category, minPrice, maxPrice, search

    const ads = useAds(db, isAuthReady, userId, queryState);
    
    const handleAdClick = (ad) => {
        setSelectedAd(ad);
        setPage('details');
    };

    const renderPage = () => {
        if (!isAuthReady || !db) {
            return (
                <div className="flex justify-center items-center h-screen text-xl" style={{ color: PRIMARY_COLOR }}>
                    Loading OIX...
                </div>
            );
        }

        switch (page) {
            case 'home':
                return (
                    <div className="container mx-auto px-4 py-8 flex flex-col md:flex-row gap-6">
                        <Sidebar setQueryState={setQueryState} currentQuery={queryState} />
                        <div className="flex-grow">
                            <h2 className="text-2xl font-bold mb-4" style={{ color: PRIMARY_COLOR }}>
                                Fresh Listings
                            </h2>
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
                                {ads.length > 0 ? (
                                    ads.map(ad => (
                                        <AdCard 
                                            key={ad.id} 
                                            ad={ad} 
                                            db={db} 
                                            userId={userId} 
                                            onAdClick={handleAdClick} 
                                        />
                                    ))
                                ) : (
                                    <p className="col-span-4 text-center text-gray-500 p-10 bg-white rounded-lg shadow-inner">
                                        No ads match your search or filter criteria.
                                    </p>
                                )}
                            </div>
                        </div>
                    </div>
                );
            case 'details':
                return <AdDetails ad={selectedAd} setPage={setPage} db={db} userId={userId} />;
            case 'post':
                return <PostAdForm setPage={setPage} db={db} userId={userId} />;
            case 'dashboard':
                return <Dashboard ads={ads} setPage={setPage} setSelectedAd={setSelectedAd} userId={userId} />;
            default:
                return <p>404 Page Not Found</p>;
        }
    };

    return (
        <div className="min-h-screen bg-gray-50 font-sans" style={{ color: PRIMARY_COLOR }}>
            {/* FIX: Removed non-standard boolean attributes 'jsx' and 'global' from the style tag
                 to fix the "Received 'true' for a non-boolean attribute 'jsx'" warning. */}
            <style>{`
                @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;800&display=swap');
                body {
                    font-family: 'Inter', sans-serif;
                }
            `}</style>
            
            <Header setPage={setPage} userId={userId} auth={auth} setQueryState={setQueryState} currentQuery={queryState} />

            <div className="flex">
                {/* Fixed Left Navigation Bar (OLX-style categories/user menu) */}
                <nav className="hidden lg:flex flex-col w-16 bg-white shadow-xl h-[calc(100vh-64px)] sticky top-16 border-r border-gray-100">
                    <NavItem icon={<Home size={24} />} label="Home" active={page === 'home'} onClick={() => setPage('home')} />
                    <NavItem icon={<User size={24} />} label="Dashboard" active={page === 'dashboard'} onClick={() => setPage('dashboard')} />
                    <NavItem icon={<MessageSquare size={24} />} label="Chat" active={false} onClick={() => console.warn('Mock: Messaging not yet implemented!')} />
                    <NavItem icon={<Settings size={24} />} label="Settings" active={false} onClick={() => console.warn('Mock: Settings not yet implemented!')} />
                </nav>

                <main className="flex-grow min-h-[calc(100vh-64px)]">
                    {renderPage()}
                </main>
            </div>
            
            {/* Footer */}
            <footer className="py-4 text-center text-sm text-white" style={{ backgroundColor: PRIMARY_COLOR }}>
                &copy; 2025 OIX Classifieds. Built with React and Firestore. User ID: {userId}
            </footer>
        </div>
    );
};

const NavItem = ({ icon, label, active, onClick }) => (
    <div
        className={`flex flex-col items-center py-4 cursor-pointer transition-colors duration-200 ${
            active ? 'bg-gray-100 text-black border-l-4 border-l-orange-400' : 'text-gray-500 hover:bg-gray-50 hover:text-black'
        }`}
        onClick={onClick}
    >
        {icon}
        <span className="text-xs mt-1">{label}</span>
    </div>
);

// Default export is mandatory for single-file React apps
export default App;