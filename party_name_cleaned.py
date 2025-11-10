import requests
import pandas as pd
import re
from difflib import get_close_matches
import json

# --- Configuration ---
URL = "https://politigraph.wevis.info/graphql"

# Query to fetch all individual votes, including their unique 'id' and 'voter_party'
VOTES_QUERY = """
  query AllVotes {
    votes {
      id
      voter_party
    }
  }
"""

# Query to fetch the canonical list of organizations/parties
ORGANIZATIONS_QUERY = """
  query Organizations {
    organizations {
      name
    }
  }
"""

# --- Utility Functions ---

def flatten_graphql_response(response_json):
    """
    Handles a GraphQL JSON response and returns a flat DataFrame.
    This logic is required to correctly parse the nested GraphQL structure.
    """
    if not isinstance(response_json, dict):
        raise ValueError("Expected a GraphQL response dict")

    data_section = response_json.get("data", {})
    if not data_section:
        raise ValueError("No 'data' key found in GraphQL response")

    # Find the first list of entities under 'data'
    data = None
    for k, v in data_section.items():
        if isinstance(v, list):
            data = v
            break
    
    if data is None:
        raise ValueError("No list-type data found inside 'data'")

    df = pd.json_normalize(data, sep='.')
    
    # Simple check for nested lists/dicts to ensure flatness
    for col in df.columns:
        if df[col].apply(lambda x: isinstance(x, (list, dict))).any():
             # If complex structure remains, this simplified function will stop here
             # For the expected VOTES_QUERY, the result should be flat.
             pass 

    return df

def clean_text(s):
    """Clean up the party name text (remove special characters and spaces)."""
    if pd.isna(s) or s is None: 
        return ""
    s = str(s).strip()
    # Remove special characters (preserving Thai/English letters, numbers, and space)
    s = re.sub(r'[^\u0E00-\u0E7Fa-zA-Z0-9\s]', '', s)
    s = re.sub(r'\s+', '', s)  # Remove all spaces
    return s

def to_canonical(s, canon_list, cutoff=0.6):
    """Find the closest canonical match using fuzzy matching."""
    if pd.isna(s) or s == '':
        return s
    match = get_close_matches(s, canon_list, n=1, cutoff=cutoff)
    if match:
        return match[0]
    return s


def generate_cleaned_party_map():
    """
    Fetches vote and organization data, cleans party names, and generates 
    a dictionary mapping {vote_id: cleaned_party_name}.
    """
    print("Fetching votes and organizations data...")
    try:
        # 1. Fetch Votes Data (ID and raw party name)
        votes_response = requests.post(URL, json={'query': VOTES_QUERY})
        votes_response.raise_for_status()
        df_votes = flatten_graphql_response(votes_response.json())

        # 2. Fetch Canonical Organizations Data
        org_response = requests.post(URL, json={'query': ORGANIZATIONS_QUERY})
        org_response.raise_for_status()
        df_org = flatten_graphql_response(org_response.json())

    except requests.exceptions.RequestException as e:
        print(f"Error fetching data from API: {e}. Cannot proceed.")
        return {}
    except ValueError as e:
        print(f"Error processing GraphQL response: {e}. Cannot proceed.")
        return {}

    # 3. Prepare Canonical List: Organization names + Senator (สมาชิกวุฒิสภา)
    canonical_list = df_org['name'].unique().tolist() + ['สมาชิกวุฒิสภา']

    # 4. Clean and Map Party Names
    df_votes['party_clean'] = df_votes['voter_party'].apply(clean_text)
    
    # Map the cleaned party names to the canonical list
    df_votes['voter_party_final'] = df_votes['party_clean'].apply(
        lambda x: to_canonical(x, canonical_list)
    )

    # 5. Create the Final Map: {vote_id: cleaned_party_name}
    # Ensure 'id' and 'voter_party_final' columns exist before zipping
    if 'id' not in df_votes.columns or 'voter_party_final' not in df_votes.columns:
        print("Required columns ('id' or 'voter_party_final') are missing.")
        return {}
        
    vote_party_map = dict(zip(df_votes['id'], df_votes['voter_party_final']))
    
    # 6. Save the map to a file for the JavaScript app to consume
    output_filename = 'cleaned_party_map.json'
    with open(output_filename, 'w', encoding='utf-8') as f:
        json.dump(vote_party_map, f, ensure_ascii=False, indent=2)

    print(f"Successfully generated and saved map to {output_filename}")
    print(f"Total entries: {len(vote_party_map)}")
    return vote_party_map

if __name__ == "__main__":
    generate_cleaned_party_map()