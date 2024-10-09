import React, { createContext, useContext, useEffect, useState } from 'react';
import * as MediaLibrary from 'expo-media-library';
import axios from 'axios';
import AsyncStorage from '@react-native-async-storage/async-storage';

interface AudioFile {
    id: string;
    filename: string;
    uri: string;
    albumCover?: string;
    artist?: string;
    album?: string;
}

interface AudioContextType {
    audioFiles: AudioFile[];
    loading: boolean; // Optional: expose loading state if needed
}

const AudioContext = createContext<AudioContextType | undefined>(undefined);

export const useAudio = () => {
    const context = useContext(AudioContext);
    if (!context) {
        throw new Error('useAudio must be used within an AudioProvider');
    }
    return context;
};

export const AudioProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [audioFiles, setAudioFiles] = useState<AudioFile[]>([]);
    const [loading, setLoading] = useState<boolean>(true);
    const [accessToken, setAccessToken] = useState<string | null>(null);
    
    const spotifyClientId = process.env.EXPO_PUBLIC_SPOTIFY_CLIENT_ID;
    const spotifyClientSecret = process.env.EXPO_PUBLIC_SPOTIFY_CLIENT_SECRET;

    const getClientCredentials = () => {
        return btoa(`${spotifyClientId}:${spotifyClientSecret}`);
    };

    // Fetch Spotify Access Token
    const fetchSpotifyToken = async () => {
        try {
            const response = await axios.post('https://accounts.spotify.com/api/token', 'grant_type=client_credentials', {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    Authorization: `Basic ${getClientCredentials()}`,
                },
            });
            const { access_token } = response.data;
            setAccessToken(access_token);
            return access_token;
        } catch (error) {
            console.error('Error fetching Spotify token:', error);
        }
    };

    // Enhance Audio with Spotify Data
    const enhanceAudioWithSpotifyData = async (audioFiles: AudioFile[], token: string) => {
        const enhancedFiles = await Promise.all(
            audioFiles.map(async (file) => {
                try {
                    const searchQuery = encodeURIComponent(file.filename.split('.')[0]);
                    const response = await axios.get(
                        `https://api.spotify.com/v1/search?q=${searchQuery}&type=track&limit=1`,
                        {
                            headers: {
                                Authorization: `Bearer ${token}`,
                            },
                        }
                    );

                    const track = response.data.tracks.items[0];
                    if (track) {
                        return {
                            ...file,
                            albumCover: track.album.images[0]?.url,
                            artist: track.artists[0]?.name,
                            album: track.album.name,
                        };
                    }
                    return file;
                } catch (error) {
                    console.error('Error fetching data from Spotify:', error);
                    return file;
                }
            })
        );
        return enhancedFiles;
    };

    // Store Enhanced Audio Data Locally
    const storeAudioData = async (enhancedFiles: AudioFile[]) => {
        try {
            const jsonData = JSON.stringify(enhancedFiles);
            await AsyncStorage.setItem('audioFiles', jsonData);
        } catch (error) {
            console.error('Error saving audio data:', error);
        }
    };

    // Load Audio Data from Local Storage
    const loadAudioDataFromStorage = async () => {
        try {
            const jsonData = await AsyncStorage.getItem('audioFiles');
            return jsonData != null ? JSON.parse(jsonData) : null;
        } catch (error) {
            console.error('Error loading audio data from storage:', error);
        }
    };

    // Fetch Audio Files from Device
    const fetchAudioFiles = async (token: string) => {
        setLoading(true);
        try {
            const { status } = await MediaLibrary.requestPermissionsAsync();
            if (status === 'granted') {
                const assets = await MediaLibrary.getAssetsAsync({
                    mediaType: MediaLibrary.MediaType.audio,
                });
                const files = assets.assets.map(asset => ({
                    id: asset.id,
                    filename: asset.filename,
                    uri: asset.uri,
                }));

                const enhancedFiles = await enhanceAudioWithSpotifyData(files, token);
                setAudioFiles(enhancedFiles);
                await storeAudioData(enhancedFiles); // Save enhanced data locally
            } else {
                console.log('Permission to access media library was denied.');
            }
        } catch (error) {
            console.error('Error fetching audio files:', error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        const initialize = async () => {
            const token = await fetchSpotifyToken();

            // Check for cached audio data when offline
            const cachedData = await loadAudioDataFromStorage();
            if (cachedData && !navigator.onLine) {
                console.log('Loaded from cache:', cachedData);
                setAudioFiles(cachedData);
                setLoading(false);
                return;
            }

            // Fetch data if online
            if (token && navigator.onLine) {
                await fetchAudioFiles(token);
            }
        };
        initialize();
    }, []);

    // Provide audio files and loading state to consumers
    return (
        <AudioContext.Provider value={{ audioFiles, loading }}>
            {children}
        </AudioContext.Provider>
    );
};
